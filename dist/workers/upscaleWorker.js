importScripts("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");

class WorkerImage {
  constructor(width, height, data = new Uint8Array(width * height * 4)) {
    this.width = width;
    this.height = height;
    this.data = data;
  }

  getImageCrop(x, y, image, x1, y1, x2, y2) {
    x = Math.round(x);
    y = Math.round(y);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    x2 = Math.round(x2);
    y2 = Math.round(y2);
    const width = x2 - x1;
    const height = y2 - y1;
    for (let j = 0; j < height; j++) {
      const destIndex = (y + j) * this.width * 4 + x * 4;
      const srcIndex = (y1 + j) * image.width * 4 + x1 * 4;
      try {
        this.data.set(
          image.data.subarray(srcIndex, srcIndex + width * 4),
          destIndex
        );
      } catch (err) {
        console.error("getImageCrop error diagnostic:", {
          destImage: { width: this.width, height: this.height, dataLength: this.data.length },
          srcImage: { width: image.width, height: image.height, dataLength: image.data.length },
          params: { x, y, x1, y1, x2, y2, width, j },
          indices: { destIndex, srcIndex, subarrayLength: width * 4 }
        });
        throw err;
      }
    }
  }

  padToTileSize(tileSize) {
    let newWidth = this.width;
    let newHeight = this.height;
    if (this.width < tileSize) {
      newWidth = tileSize;
    }
    if (this.height < tileSize) {
      newHeight = tileSize;
    }
    if (newWidth === this.width && newHeight === this.height) {
      return;
    }
    const newData = new Uint8Array(newWidth * newHeight * 4);
    for (let y = 0; y < this.height; y++) {
      const srcStart = y * this.width * 4;
      const destStart = y * newWidth * 4;
      newData.set(
        this.data.subarray(srcStart, srcStart + this.width * 4),
        destStart
      );
    }
    if (newWidth > this.width) {
      const rightColumnIndex = (this.width - 1) * 4;
      for (let y = 0; y < this.height; y++) {
        const destRowStart = y * newWidth * 4;
        const srcPixelIndex = y * this.width * 4 + rightColumnIndex;
        const padPixel = this.data.subarray(srcPixelIndex, srcPixelIndex + 4);
        for (let x = this.width; x < newWidth; x++) {
          const destPixelIndex = destRowStart + x * 4;
          newData.set(padPixel, destPixelIndex);
        }
      }
    }
    if (newHeight > this.height) {
      const bottomRowStart = (this.height - 1) * newWidth * 4;
      const bottomRow = newData.subarray(
        bottomRowStart,
        bottomRowStart + newWidth * 4
      );
      for (let y = this.height; y < newHeight; y++) {
        const destRowStart = y * newWidth * 4;
        newData.set(bottomRow, destRowStart);
      }
    }
    this.width = newWidth;
    this.height = newHeight;
    this.data = newData;
  }

  cropToOriginalSize(width, height) {
    const newData = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcStart = y * this.width * 4;
      const destStart = y * width * 4;
      newData.set(
        this.data.subarray(srcStart, srcStart + width * 4),
        destStart
      );
    }
    this.width = width;
    this.height = height;
    this.data = newData;
  }
}

function img2tensor(image) {

  const rgba = tf.tensor3d(image.data, [image.height, image.width, 4], 'int32');
  const rgb = rgba.slice([0, 0, 0], [-1, -1, 3]);
  const tensor = rgb.toFloat().div(255).expandDims();
  rgba.dispose();
  rgb.dispose();
  return tensor;
}

async function tensor2img(tensor) {
  const [_, height, width, __] = tensor.shape;

  const rgba = tf.tidy(() => {
    const rgb = tensor.reshape([height, width, 3]).mul(255).clipByValue(0, 255).cast("int32");
    const alpha = tf.fill([height, width, 1], 255, "int32");
    return tf.concat([rgb, alpha], 2);
  });
  tensor.dispose();

  const data = await rgba.data();
  rgba.dispose();

  const uint8Data = new Uint8Array(data);
  const image = new WorkerImage(width, height, uint8Data);
  return image;
}

async function upscale(image, model, alpha = false) {
  const result = tf.tidy(() => {
    const tensor = img2tensor(image);
    let predictRes = model.predict(tensor);
    if (alpha) {
      predictRes = tf.greater(predictRes, 0.5);
    }
    return predictRes;
  });
  const resultImage = await tensor2img(result);
  tf.dispose(result);
  return resultImage;
}

let isBackendInitialized = false;
let cachedModel = null;
let cachedModelName = "";

self.addEventListener("message", async (e) => {
  const { data } = e;
  let model_url = "";
  let model_name = "";

  if (data?.model_type === "realesrgan") {
    model_url = `/realesrgan/${data?.model}-${data?.tile_size}/model.json`;
    model_name = `realesrgan-${data?.model}-${data?.tile_size}`;
  } else {
    model_url = `/realcugan/${data?.factor}x-${data?.denoise}-${data?.tile_size}/model.json`;
    model_name = `realcugan-${data?.factor}x-${data?.denoise}-${data?.tile_size}`;
  }

  const absolute_model_url = self.location.origin + model_url;

  if (!isBackendInitialized) {
    self.postMessage({ info: "Initializing TFJS backend..." });

    try {

      const safeSetFlag = (name, value) => {
        try {
          if (tf.env().flags && name in tf.env().flags) {
            tf.env().set(name, value);
          }
        } catch (e) {
          console.warn(`Could not set TFJS flag ${name}:`, e);
        }
      };

      await tf.ready();

      self.postMessage({ info: `TFJS ready. Setting backend to ${data?.backend || "webgl"}...` });

      safeSetFlag('CHECK_COMPUTATION_FOR_ERRORS', false);

      safeSetFlag('WEBGL_VERSION', 2);
      safeSetFlag('WEBGL_FORCE_F16_TEXTURES', false);
      safeSetFlag('WEBGL_FORCE_F16_OPERATOR', false);
      safeSetFlag('WEBGL_PACK', true);
      safeSetFlag('WEBGL_EXP_CONV', true);
      safeSetFlag('WEBGL_PACK_BINARY_OPERATIONS', true);
      safeSetFlag('WEBGL_PACK_IMAGE_OPERATIONS', true);
      safeSetFlag('WEBGL_LAZILY_UNPACK', true);

      if (!(await tf.setBackend(data?.backend || "webgl"))) {
        self.postMessage({
          alertmsg: `${data?.backend} backend is not supported or initialized in your browser.`,
          info: `Error: ${data?.backend} not supported.`
        });
        return;
      }

      isBackendInitialized = true;
      self.postMessage({ info: `Backend set to ${tf.getBackend()}. Loading model...` });
    } catch (err) {
      self.postMessage({
        alertmsg: `Failed to set backend: ${err.message}`,
        info: `Error: ${err.message}`
      });
      return;
    }
  }

  let model;
  if (cachedModel && cachedModelName === model_name) {
    model = cachedModel;
  } else {
    if (cachedModel) {
      try {
        cachedModel.dispose();
      } catch (err) {
        console.warn("Error disposing cached model:", err);
      }
      cachedModel = null;
      cachedModelName = "";
    }

    try {
      model = await tf.loadGraphModel(`indexeddb://${model_name}`);
      console.log("✅ [Upscale Model] Loaded model SUCCESSFULLY from IndexedDB cache:", model_name);
      self.postMessage({ info: "Loaded from cache" });
    } catch (error) {
      console.log("🚀 [Upscale Model] Downloading model weights:", absolute_model_url);
      self.postMessage({ info: "Downloading model..." });

      const urlsToTry = [
        absolute_model_url,
        `https://upscale.chino.icu${model_url}`
      ];

      let loadedModel = null;
      let lastErr = null;

      for (const targetUrl of urlsToTry) {
        try {
          console.log("🚀 [Upscale Model] Attempting model fetch from:", targetUrl);
          loadedModel = await tf.loadGraphModel(targetUrl);
          await loadedModel.save(`indexeddb://${model_name}`);
          console.log("✅ [Upscale Model] Model downloaded and cached in IndexedDB SUCCESSFULLY from:", targetUrl);
          self.postMessage({ info: "Model cached successfully" });
          break;
        } catch (fetchErr) {
          console.warn("⚠️ [Upscale Model] Failed to fetch from:", targetUrl, fetchErr.message);
          lastErr = fetchErr;
        }
      }

      if (!loadedModel) {
        self.postMessage({
          alertmsg: `Failed to download model weights from ${absolute_model_url}. Error: ${lastErr ? lastErr.message : 'Network error'}`,
        });
        return;
      }

      model = loadedModel;
    }

    cachedModel = model;
    cachedModelName = model_name;
  }

  if (!model) {
    self.postMessage({ alertmsg: "Model failed to load." });
    return;
  }

  const input = new WorkerImage(data.width, data.height, new Uint8Array(data.input));
  const width_ori = input.width;
  const height_ori = input.height;
  input.padToTileSize(data?.tile_size || 64);

  let withPadding = false;
  if (input.width !== width_ori || input.height !== height_ori) {
    withPadding = true;
  }

  let hasAlpha = data.hasAlpha;
  function sendprogress(progress) {
    if (hasAlpha) {
      self.postMessage({
        progress: progress,
        info: `Processing Alpha ${progress.toFixed(1)}%`,
      });
    } else {
      self.postMessage({
        progress: progress,
        info: `Processing ${progress.toFixed(1)}%`,
      });
    }
  }

  async function enlargeImageWithFixedInput(
    model,
    inputImg,
    factor = 4,
    tile_size = 64,
    margin = 12
  ) {
    const width = inputImg.width;
    const height = inputImg.height;
    const output = new WorkerImage(width * factor, height * factor);

    const step = tile_size - 2 * margin;
    const num_x = Math.ceil(width / step);
    const num_y = Math.ceil(height / step);
    const total = num_x * num_y;
    let current = 0;

    for (let y = 0; y < height; y += step) {
      const tile_h = Math.min(step, height - y);
      const src_y1 = Math.max(0, y - margin);
      const src_y2 = Math.min(height, y + tile_h + margin);
      const crop_top = (y - src_y1) * factor;

      for (let x = 0; x < width; x += step) {
        const tile_w = Math.min(step, width - x);
        const src_x1 = Math.max(0, x - margin);
        const src_x2 = Math.min(width, x + tile_w + margin);
        const crop_left = (x - src_x1) * factor;

        const tile_src_w = src_x2 - src_x1;
        const tile_src_h = src_y2 - src_y1;

        const tile = new WorkerImage(tile_src_w, tile_src_h);
        tile.getImageCrop(0, 0, inputImg, src_x1, src_y1, src_x2, src_y2);

        tile.padToTileSize(tile_size);

        const scaled = await upscale(tile, model, hasAlpha);

        scaled.cropToOriginalSize(tile_src_w * factor, tile_src_h * factor);

        output.getImageCrop(
          x * factor,
          y * factor,
          scaled,
          crop_left,
          crop_top,
          crop_left + tile_w * factor,
          crop_top + tile_h * factor
        );

        current++;
        let progress = (current / total) * 100;
        sendprogress(progress);
      }
    }

    return output;
  }

  const factor = data?.factor || 4;
  const tile_size = data?.tile_size || 64;
  const min_lap = data?.min_lap || 12;

  let output;
  try {
    output = await enlargeImageWithFixedInput(
      model,
      input,
      factor,
      tile_size,
      min_lap
    );
  } catch (e) {
    self.postMessage({ alertmsg: `Upscale runtime error: ${e.toString()}` });
    return;
  }

  if (withPadding) {
    output.cropToOriginalSize(width_ori * factor, height_ori * factor);
  }

  await new Promise((resolve) => setTimeout(resolve, 10));

  self.postMessage(
    {
      progress: 100,
      done: true,
      output: output.data.buffer,
      info: `Processing complete`,
    },
    [output.data.buffer]
  );
});
