(function() {
    'use strict';

    function t(key) {
        if (typeof window.getTranslation === 'function') {
            const res = window.getTranslation(key);
            if (res && res !== key) return res;
        }
        return key;
    }

    let selectedFile = null;
    let loadedXmlText = null;
    let currentFilter = 'all';

    function setButtonState(state, text) {
        const processBtn = document.getElementById('tool-process-btn');
        const processLabel = document.getElementById('tool-process-label');
        if (!processBtn) return;

        if (state === 'processing') {
            processBtn.disabled = true;
            processBtn.dataset.state = 'processing';
            if (processLabel) processLabel.textContent = text || t('status_processing') || "Generating 5MB XML...";
        } else if (state === 'completed') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'completed';
            if (processLabel) processLabel.textContent = text || t('status_process_another') || "Process Another";
        } else if (state === 'error') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'error';
            if (processLabel) processLabel.textContent = text || "Processing Failed";
            setTimeout(() => {
                setButtonState('ready');
            }, 3500);
        } else {
            processBtn.disabled = !selectedFile || !loadedXmlText;
            processBtn.dataset.state = (selectedFile && loadedXmlText) ? 'ready' : 'idle';
            if (processLabel) processLabel.textContent = text || t('tool_fivemb_btn_export') || "Generate 5MB XML";
        }
    }

    function initFiveMbUI(ctx) {
        const { optContainer, processLabel } = ctx;
        if (!optContainer) return;

        if (processLabel) processLabel.textContent = t('tool_fivemb_btn_export') || 'Generate 5MB XML';

        optContainer.innerHTML = `
            <div id="fivemb-layers-container" class="fivemb-container hidden">
                <div class="fivemb-header-row">
                    <span class="fivemb-title">${t('tool_fivemb_layer_list_title') || 'Select Media Layers to Replace:'}</span>
                    <div class="fivemb-actions-group">
                        <button type="button" class="fivemb-action-btn" id="fivemb-select-all">${t('tool_fivemb_select_all') || 'Select All'}</button>
                        <button type="button" class="fivemb-action-btn" id="fivemb-deselect-all">${t('tool_fivemb_deselect_all') || 'Deselect All'}</button>
                    </div>
                </div>

                <div class="fivemb-filter-tabs" id="fivemb-filter-tabs"></div>

                <div class="fivemb-layers-list" id="fivemb-layers-list"></div>
            </div>
        `;

        const selectAllBtn = document.getElementById('fivemb-select-all');
        const deselectAllBtn = document.getElementById('fivemb-deselect-all');
        const layersList = document.getElementById('fivemb-layers-list');

        if (selectAllBtn && layersList) {
            selectAllBtn.addEventListener('click', () => {
                layersList.querySelectorAll('.fivemb-layer-item').forEach(item => {
                    if (item.style.display !== 'none') {
                        const cb = item.querySelector('.layer-checkbox');
                        if (cb && !cb.checked) {
                            cb.checked = true;
                            item.classList.add('selected');
                        }
                    }
                });
            });
        }

        if (deselectAllBtn && layersList) {
            deselectAllBtn.addEventListener('click', () => {
                layersList.querySelectorAll('.fivemb-layer-item').forEach(item => {
                    if (item.style.display !== 'none') {
                        const cb = item.querySelector('.layer-checkbox');
                        if (cb && cb.checked) {
                            cb.checked = false;
                            item.classList.remove('selected');
                        }
                    }
                });
            });
        }
    }

    function extractLayers(xmlDoc) {
        const layers = [];
        const mediaMap = {};

        const mediaTags = xmlDoc.getElementsByTagName("media");
        for (let i = 0; i < mediaTags.length; i++) {
            const m = mediaTags[i];
            const uri = m.getAttribute("uri") || "";
            if (uri) {
                mediaMap[uri] = {
                    filename: m.getAttribute("filename") || m.getAttribute("title") || "",
                    type: m.getAttribute("type") || "",
                    uri: uri
                };
            }
        }

        const shapes = xmlDoc.getElementsByTagName("shape");
        for (let i = 0; i < shapes.length; i++) {
            const shape = shapes[i];
            const id = shape.getAttribute("id");
            const fillType = shape.getAttribute("fillType");
            const fillImage = shape.getAttribute("fillImage");
            const fillVideo = shape.getAttribute("fillVideo");
            const label = shape.getAttribute("label") || "";
            const startTime = shape.getAttribute("startTime");
            const endTime = shape.getAttribute("endTime");

            const isMediaFill = (fillType === "media") || fillImage || fillVideo;
            const hasMediaLabel = /\.(png|jpe?g|webp|gif|mp4|mov|3gp|mkv|webm)$/i.test(label);

            if (isMediaFill || hasMediaLabel) {
                let type = "photo";
                let fileInfo = "";

                if (fillVideo) {
                    type = "video";
                    const med = mediaMap[fillVideo];
                    fileInfo = med ? med.filename : fillVideo;
                } else if (fillImage) {
                    type = "photo";
                    const med = mediaMap[fillImage];
                    fileInfo = med ? med.filename : fillImage;
                } else {
                    type = /\.(mp4|mov|3gp|mkv|webm)$/i.test(label) ? "video" : "photo";
                }

                let durationStr = "";
                if (startTime !== null && endTime !== null) {
                    const diff = (parseFloat(endTime) || 0) - (parseFloat(startTime) || 0);
                    if (diff > 0) durationStr = `${(diff / 1000).toFixed(2)}s`;
                }

                layers.push({
                    id: id,
                    label: label || `Layer ${id}`,
                    type: type,
                    fileInfo: fileInfo || label,
                    duration: durationStr
                });
            }
        }

        const audios = xmlDoc.getElementsByTagName("audio");
        for (let i = 0; i < audios.length; i++) {
            const audio = audios[i];
            const id = audio.getAttribute("id");
            const label = audio.getAttribute("label") || audio.getAttribute("name") || "";
            const src = audio.getAttribute("src") || audio.getAttribute("audio") || "";
            const startTime = audio.getAttribute("startTime");
            const endTime = audio.getAttribute("endTime");

            const med = mediaMap[src];
            const fileInfo = med ? med.filename : src;
            let durationStr = "";
            if (startTime !== null && endTime !== null) {
                const diff = (parseFloat(endTime) || 0) - (parseFloat(startTime) || 0);
                if (diff > 0) durationStr = `${(diff / 1000).toFixed(2)}s`;
            }

            layers.push({
                id: id,
                label: label || `Audio ${id}`,
                type: "audio",
                fileInfo: fileInfo || label,
                duration: durationStr
            });
        }

        return { layers, mediaMap };
    }

    function renderFilterTabs(layers) {
        const filterTabsContainer = document.getElementById('fivemb-filter-tabs');
        const layersList = document.getElementById('fivemb-layers-list');
        if (!filterTabsContainer || !layersList) return;

        const counts = { all: layers.length, photo: 0, video: 0, audio: 0 };
        layers.forEach(l => { if (counts[l.type] !== undefined) counts[l.type]++; });

        const tabs = [
            { key: 'all', labelKey: 'tool_fivemb_filter_all', icon: 'layers', fallback: 'All' },
            { key: 'photo', labelKey: 'tool_fivemb_filter_photo', icon: 'image', fallback: 'Photos' },
            { key: 'video', labelKey: 'tool_fivemb_filter_video', icon: 'movie', fallback: 'Videos' },
            { key: 'audio', labelKey: 'tool_fivemb_filter_audio', icon: 'audiotrack', fallback: 'Audios' }
        ];

        filterTabsContainer.innerHTML = '';
        currentFilter = 'all';

        tabs.forEach(tab => {
            if (tab.key !== 'all' && counts[tab.key] === 0) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'fivemb-filter-tab' + (currentFilter === tab.key ? ' active' : '');
            btn.dataset.filter = tab.key;
            btn.innerHTML = `
                <span class="material-symbols-rounded">${tab.icon}</span>
                <span>${t(tab.labelKey) || tab.fallback}</span>
                <span class="fivemb-filter-count">${counts[tab.key]}</span>
            `;
            btn.addEventListener('click', () => {
                currentFilter = tab.key;
                filterTabsContainer.querySelectorAll('.fivemb-filter-tab').forEach(b => {
                    b.classList.toggle('active', b.dataset.filter === currentFilter);
                });
                layersList.querySelectorAll('.fivemb-layer-item').forEach(item => {
                    const visible = currentFilter === 'all' || item.dataset.type === currentFilter;
                    item.style.display = visible ? '' : 'none';
                });
                if (typeof window.updateOpenModalsLayout === 'function') window.updateOpenModalsLayout(true);
            });
            filterTabsContainer.appendChild(btn);
        });
    }

    function createLayerItem(layer) {
        let typeIcon = "image";
        let typeLabel = t('tool_fivemb_type_photo') || "Photo";
        let badgeClass = "photo";

        if (layer.type === "video") {
            typeIcon = "movie";
            typeLabel = t('tool_fivemb_type_video') || "Video";
            badgeClass = "video";
        } else if (layer.type === "audio") {
            typeIcon = "audiotrack";
            typeLabel = t('tool_fivemb_type_audio') || "Audio";
            badgeClass = "audio";
        }

        const durationStr = layer.duration ? ` • ${layer.duration}` : "";
        const item = document.createElement("div");
        item.className = "fivemb-layer-item selected";
        item.dataset.type = layer.type;
        item.dataset.id = layer.id;

        item.innerHTML = `
            <div class="fivemb-layer-left">
                <div class="fivemb-checkbox-wrapper">
                    <input type="checkbox" class="layer-checkbox" data-id="${layer.id}" checked>
                    <span class="fivemb-checkbox-custom"></span>
                </div>
                <span class="material-symbols-rounded fivemb-layer-icon">${typeIcon}</span>
                <div class="fivemb-layer-text">
                    <span class="fivemb-layer-name" title="${layer.label}">${layer.label}</span>
                    <span class="fivemb-layer-sub">ID: ${layer.id}${durationStr} • ${layer.fileInfo}</span>
                </div>
            </div>
            <span class="fivemb-layer-badge ${badgeClass}">${typeLabel}</span>
        `;

        const checkbox = item.querySelector(".layer-checkbox");
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) item.classList.add("selected");
            else item.classList.remove("selected");
        });

        item.addEventListener("click", (e) => {
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event("change"));
            }
        });

        return item;
    }

    function parseXmlFile(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                loadedXmlText = e.target.result;
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(loadedXmlText, "text/xml");

                if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
                    throw new Error("Failed to parse XML file. Corrupted or invalid format.");
                }

                const { layers } = extractLayers(xmlDoc);
                const layersContainer = document.getElementById('fivemb-layers-container');
                const layersList = document.getElementById('fivemb-layers-list');

                if (layersContainer && layersList) {
                    renderFilterTabs(layers);
                    layersList.innerHTML = '';
                    if (layers.length === 0) {
                        layersList.innerHTML = `<div class="fivemb-empty-notice">${t('tool_fivemb_no_layers') || 'No media layers found in this XML.'}</div>`;
                    } else {
                        layers.forEach(l => layersList.appendChild(createLayerItem(l)));
                    }
                    layersContainer.classList.remove('hidden');
                    if (typeof window.updateOpenModalsLayout === 'function') window.updateOpenModalsLayout(true);
                }

                setButtonState('ready', t('tool_fivemb_btn_export') || 'Generate 5MB XML');

            } catch (err) {
                console.error('[5MB Generator] Error parsing XML:', err);
                setButtonState('error', err.message || 'Invalid XML file');
            }
        };
        reader.readAsText(file);
    }

    function getPlaceholderFilename(type, originalLabel) {
        if (type === 'video') {
            if (/\.mov$/i.test(originalLabel)) return 'placeholder.mov';
            if (/\.3gp$/i.test(originalLabel)) return 'placeholder.3gp';
            if (/\.mkv$/i.test(originalLabel)) return 'placeholder.mkv';
            if (/\.webm$/i.test(originalLabel)) return 'placeholder.webm';
            return 'placeholder.mp4';
        }
        if (type === 'photo') {
            if (/\.jpe?g$/i.test(originalLabel)) return 'placeholder.jpg';
            if (/\.webp$/i.test(originalLabel)) return 'placeholder.webp';
            if (/\.gif$/i.test(originalLabel)) return 'placeholder.gif';
            return 'placeholder.png';
        }
        if (type === 'audio') {
            if (/\.wav$/i.test(originalLabel)) return 'placeholder.wav';
            if (/\.ogg$/i.test(originalLabel)) return 'placeholder.ogg';
            if (/\.aac$/i.test(originalLabel)) return 'placeholder.aac';
            return 'placeholder.mp3';
        }
        return 'placeholder';
    }

    function generate5MbXml() {
        if (!selectedFile || !loadedXmlText) return;

        setButtonState('processing', t('status_processing') || 'Processing XML...');

        try {
            const layersList = document.getElementById('fivemb-layers-list');
            const checkedBoxes = layersList ? layersList.querySelectorAll('.layer-checkbox:checked') : [];
            const selectedIds = new Set();
            checkedBoxes.forEach(cb => selectedIds.add(cb.getAttribute('data-id')));

            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(loadedXmlText, "text/xml");
            const activeMediaUris = new Set();

            const shapes = xmlDoc.getElementsByTagName("shape");
            for (let i = 0; i < shapes.length; i++) {
                const shape = shapes[i];
                const id = shape.getAttribute("id");
                const fillType = shape.getAttribute("fillType");
                const fillImage = shape.getAttribute("fillImage");
                const fillVideo = shape.getAttribute("fillVideo");
                const label = shape.getAttribute("label") || "";

                const isMediaFill = (fillType === "media") || fillImage || fillVideo;
                const hasMediaLabel = /\.(png|jpe?g|webp|gif|mp4|mov|3gp|mkv|webm)$/i.test(label);

                if (isMediaFill || hasMediaLabel) {
                    if (selectedIds.has(id)) {
                        const isVideo = fillVideo || /\.(mp4|mov|3gp|mkv|webm)$/i.test(label);
                        const layerType = isVideo ? 'video' : 'photo';
                        const placeholder = getPlaceholderFilename(layerType, label);

                        shape.setAttribute("fillType", "media");
                        if (isVideo) {
                            shape.setAttribute("fillVideo", placeholder);
                            shape.removeAttribute("fillImage");
                            shape.setAttribute("label", placeholder);
                        } else {
                            shape.setAttribute("fillImage", placeholder);
                            shape.removeAttribute("fillVideo");
                            shape.setAttribute("label", placeholder);
                        }

                        const existingFillColor = shape.getElementsByTagName("fillColor")[0];
                        if (existingFillColor) existingFillColor.parentNode.removeChild(existingFillColor);
                    } else {
                        if (fillImage) activeMediaUris.add(fillImage);
                        if (fillVideo) activeMediaUris.add(fillVideo);
                    }
                }
            }

            const audios = xmlDoc.getElementsByTagName("audio");
            for (let i = 0; i < audios.length; i++) {
                const audio = audios[i];
                const id = audio.getAttribute("id");
                const src = audio.getAttribute("src") || audio.getAttribute("audio") || "";
                const label = audio.getAttribute("label") || audio.getAttribute("name") || "";
                const placeholder = getPlaceholderFilename('audio', label);

                if (selectedIds.has(id)) {
                    audio.setAttribute("name", placeholder);
                    audio.setAttribute("audio", placeholder);
                    audio.setAttribute("audioVideo", placeholder);
                    audio.setAttribute("sound", placeholder);
                    audio.setAttribute("enabled", "false");
                    if (audio.hasAttribute("src")) audio.setAttribute("src", placeholder);
                } else {
                    if (src) activeMediaUris.add(src);
                }
            }

            const mediaElements = xmlDoc.getElementsByTagName("media");
            for (let i = mediaElements.length - 1; i >= 0; i--) {
                const media = mediaElements[i];
                const uri = media.getAttribute("uri") || "";
                const type = media.getAttribute("type") || "";

                if (uri && !activeMediaUris.has(uri)) {
                    if (type.includes("video") || type.includes("image")) {
                        media.parentNode.removeChild(media);
                    } else if (type.includes("audio")) {
                        media.setAttribute("url", "placeholder.mp3");
                        media.setAttribute("src", "placeholder.mp3");
                        media.setAttribute("path", "placeholder.mp3");
                    }
                }
            }

            const serializer = new XMLSerializer();
            const modifiedXml = serializer.serializeToString(xmlDoc);

            const blob = new Blob([modifiedXml], { type: 'text/xml' });
            const url = URL.createObjectURL(blob);

            const outName = selectedFile.name.replace(/\.xml$/i, '') + '_5mb.xml';
            const a = document.createElement('a');
            a.href = url;
            a.download = outName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setButtonState('completed', t('status_process_another') || 'Process Another');

            if (typeof window.showToast === 'function') {
                window.showToast(t('status_xml_success') || '5MB XML generated successfully!');
            }

        } catch (err) {
            console.error('[5MB Generator] Export error:', err);
            setButtonState('error', 'XML Export failed');
        }
    }

    const toolDefinition = {
        id: 'tool-5mb-generator',
        _id: 'tool-5mb-generator',
        version: '1.0.0',
        title: '5MB XML Generator',
        titleKey: 'tool_fivemb_title',
        desc: 'Alight Motion',
        descKey: 'tool_fivemb_desc',
        dropKey: 'tool_fivemb_drop',
        icon: 'folder_zip',
        category: 'Tools',
        features: [
            'Interactive Layer Selector with Visual Filter Tabs',
            'Safe Placeholder Replacement (Zero Animation Loss)',
            'Auto Media & Audio Optimization (< 5MB guaranteed)',
            '100% Client-side Instant XML Processing'
        ],
        specs: [
            { label: 'INPUT', value: 'Alight Motion XML (.xml)' },
            { label: 'OUTPUT', value: '5MB Optimized XML' },
            { label: 'PLATFORM', value: 'Android & iOS Alight Motion' }
        ],
        initModal: function(ctx) {
            initFiveMbUI(ctx);
            selectedFile = null;
            loadedXmlText = null;
        },
        onFileSelect: function(file) {
            if (!file || !file.name.toLowerCase().endsWith('.xml')) {
                setButtonState('error', 'Please select an XML file');
                return;
            }
            selectedFile = file;
            parseXmlFile(file);
        },
        onProcess: function() {
            generate5MbXml();
        },
        onReset: function() {
            selectedFile = null;
            loadedXmlText = null;
            currentFilter = 'all';
            const layersContainer = document.getElementById('fivemb-layers-container');
            const layersList = document.getElementById('fivemb-layers-list');
            if (layersContainer) layersContainer.classList.add('hidden');
            if (layersList) layersList.innerHTML = '';
        }
    };

    if (window.AppTools && typeof window.AppTools.register === 'function') {
        window.AppTools.register(toolDefinition);
    } else {
        window._pendingTools = window._pendingTools || [];
        window._pendingTools.push(toolDefinition);
    }

    window.FiveMbGeneratorTool = toolDefinition;
})();
