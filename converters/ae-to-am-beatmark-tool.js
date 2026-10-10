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
    let foundCompositions = [];
    let parsedBeats = [];

    function setButtonState(state, text) {
        const processBtn = document.getElementById('tool-process-btn');
        const processLabel = document.getElementById('tool-process-label');
        if (!processBtn) return;

        if (state === 'processing') {
            processBtn.disabled = true;
            processBtn.dataset.state = 'processing';
            if (processLabel) processLabel.textContent = text || t('status_processing') || "Converting...";
        } else if (state === 'completed') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'completed';
            if (processLabel) processLabel.textContent = text || t('status_process_another') || "Process Another";
        } else if (state === 'error') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'error';
            if (processLabel) processLabel.textContent = text || "Conversion Failed";
            setTimeout(() => {
                setButtonState('ready');
            }, 3500);
        } else {
            processBtn.disabled = !selectedFile || foundCompositions.length === 0;
            processBtn.dataset.state = (selectedFile && foundCompositions.length > 0) ? 'ready' : 'idle';
            if (processLabel) processLabel.textContent = text || t('tool_ae_am_btn_convert') || "Convert to Alight Motion XML";
        }
    }

    function initAeAmUI(ctx) {
        const { optContainer, processLabel } = ctx;
        if (!optContainer) return;

        if (processLabel) processLabel.textContent = t('tool_ae_am_btn_convert') || 'Convert to Alight Motion XML';

        optContainer.innerHTML = `
            <div id="ae-am-config-section" class="ae-am-container hidden">
                <div class="ae-am-group">
                    <label class="ae-am-label" for="ae-am-comp-select">
                        <span class="material-symbols-rounded">layers</span>
                        <span>${t('tool_ae_am_select_comp') || 'Select AE Composition'}</span>
                    </label>
                    <select id="ae-am-comp-select" class="ae-am-select"></select>
                </div>

                <div class="ae-am-summary-card" id="ae-am-beat-summary">
                    <span class="ae-am-beat-count">0 Beats Detected</span>
                </div>

                <div class="ae-am-group">
                    <label class="ae-am-label" for="ae-am-title-input">
                        <span class="material-symbols-rounded">title</span>
                        <span>${t('tool_ae_am_project_title') || 'Project Title'}</span>
                    </label>
                    <input type="text" id="ae-am-title-input" class="ae-am-input" value="Project XML">
                </div>

                <div class="ae-am-grid-2">
                    <div class="ae-am-group">
                        <label class="ae-am-label" for="ae-am-width-input">
                            <span class="material-symbols-rounded">aspect_ratio</span>
                            <span>Width</span>
                        </label>
                        <input type="number" id="ae-am-width-input" class="ae-am-input" value="1080">
                    </div>
                    <div class="ae-am-group">
                        <label class="ae-am-label" for="ae-am-height-input">
                            <span class="material-symbols-rounded">aspect_ratio</span>
                            <span>Height</span>
                        </label>
                        <input type="number" id="ae-am-height-input" class="ae-am-input" value="1920">
                    </div>
                </div>

                <div class="ae-am-grid-2">
                    <div class="ae-am-group">
                        <label class="ae-am-label" for="ae-am-fps-input">
                            <span class="material-symbols-rounded">speed</span>
                            <span>FPS</span>
                        </label>
                        <input type="number" id="ae-am-fps-input" class="ae-am-input" value="30">
                    </div>
                    <div class="ae-am-group">
                        <label class="ae-am-label" for="ae-am-duration-input">
                            <span class="material-symbols-rounded">schedule</span>
                            <span>Duration (ms)</span>
                        </label>
                        <input type="number" id="ae-am-duration-input" class="ae-am-input" value="5000">
                    </div>
                </div>
            </div>
        `;

        const compSelect = document.getElementById('ae-am-comp-select');
        if (compSelect) {
            compSelect.addEventListener('change', (e) => {
                selectComposition(parseInt(e.target.value, 10));
            });
        }
    }

    function extractBeatsFromComp(compElement) {
        let timebase = 30720;
        let detectedFps = 30;

        const cdtaNode = compElement.querySelector('cdta');
        if (cdtaNode) {
            const bdata = cdtaNode.getAttribute('bdata');
            if (bdata && bdata.length >= 24) {
                const frameDurationTicks = parseInt(bdata.substring(8, 16), 16);
                const extractedTimebase = parseInt(bdata.substring(16, 24), 16);
                if (frameDurationTicks > 0 && extractedTimebase > 0) {
                    timebase = extractedTimebase;
                    detectedFps = Math.round(timebase / frameDurationTicks);
                }
            }
        }

        const beats = [];
        const ldatNodes = compElement.querySelectorAll('mrst list ldat');

        ldatNodes.forEach((ldat) => {
            const bdata = ldat.getAttribute('bdata');
            if (bdata) {
                for (let i = 0; i < bdata.length; i += 32) {
                    if (i + 32 > bdata.length) break;
                    const chunk = bdata.substring(i, i + 32);
                    const hexTime = chunk.substring(0, 8);
                    const val = parseInt(hexTime, 16);
                    if (!isNaN(val)) {
                        const ms = Math.round((val / timebase) * 1000);
                        if (!beats.includes(ms)) beats.push(ms);
                    }
                }
            }
        });

        beats.sort((a, b) => a - b);
        return { beats, detectedFps, timebase };
    }

    function selectComposition(index) {
        const comp = foundCompositions.find((c) => c.id === index);
        if (!comp) return;

        const { beats, detectedFps, timebase } = extractBeatsFromComp(comp.element);
        parsedBeats = beats;

        const compTitle = document.getElementById('ae-am-title-input');
        const compFps = document.getElementById('ae-am-fps-input');
        const compDuration = document.getElementById('ae-am-duration-input');
        const beatSummary = document.getElementById('ae-am-beat-summary');

        if (compTitle) compTitle.value = comp.name;
        if (compFps) compFps.value = detectedFps;

        if (beatSummary) {
            if (parsedBeats.length > 0) {
                const lastBeat = parsedBeats[parsedBeats.length - 1];
                const frameDurationMs = Math.ceil(1000 / detectedFps);
                if (compDuration) compDuration.value = lastBeat + frameDurationMs;

                beatSummary.innerHTML = `
                    <span class="ae-am-beat-count">${(t('tool_ae_am_beats_loaded') || '{count} Beats Loaded').replace('{count}', parsedBeats.length)}</span>
                    <span class="ae-am-beat-meta">${detectedFps} FPS · timebase ${timebase}</span>
                `;
            } else {
                if (compDuration) compDuration.value = 5000;
                beatSummary.innerHTML = `<span class="ae-am-beat-warn">${t('tool_ae_am_no_beats') || 'No beat markers found in this composition.'}</span>`;
            }
        }
    }

    function parseAeFile(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(e.target.result, 'text/xml');
                if (!xmlDoc.querySelector('AfterEffectsProject')) {
                    throw new Error(t('tool_ae_am_error_invalid') || "Invalid After Effects Project XML.");
                }

                foundCompositions = [];
                const items = xmlDoc.querySelectorAll('Fold > Item');

                items.forEach((item, index) => {
                    const nameNode = item.querySelector('string');
                    const hasLayers = item.querySelector('SLay') || item.querySelector('CLay');
                    if (nameNode && hasLayers) {
                        foundCompositions.push({
                            id: index,
                            name: nameNode.textContent,
                            element: item
                        });
                    }
                });

                if (foundCompositions.length === 0) {
                    throw new Error(t('tool_ae_am_error_no_comp') || "No valid compositions found in project.");
                }

                const compSelect = document.getElementById('ae-am-comp-select');
                const configSection = document.getElementById('ae-am-config-section');

                if (compSelect && configSection) {
                    compSelect.innerHTML = '';
                    foundCompositions.forEach(comp => {
                        const opt = document.createElement('option');
                        opt.value = comp.id;
                        opt.textContent = comp.name;
                        compSelect.appendChild(opt);
                    });

                    selectComposition(foundCompositions[0].id);
                    configSection.classList.remove('hidden');
                    if (typeof window.updateOpenModalsLayout === 'function') window.updateOpenModalsLayout(true);
                }

                setButtonState('ready', t('tool_ae_am_btn_convert') || 'Convert to Alight Motion XML');

            } catch (err) {
                console.error('[AE to AM] Error parsing AE XML:', err);
                setButtonState('error', err.message || 'Invalid AE XML file');
            }
        };
        reader.readAsText(file);
    }

    function escapeXml(str) {
        return str.replace(/[<>&'"]/g, (c) => {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
                default: return c;
            }
        });
    }

    function generateAmXml({ title, w, h, fps, duration, parsedBeats }) {
        let xmlStr = `<?xml version='1.0' encoding='UTF-8' ?>\n`;
        xmlStr += `<scene title="${escapeXml(title)}" width="${w}" height="${h}" exportWidth="${w}" exportHeight="${h}" precompose="dynamicResolution" bgcolor="#ff000000" totalTime="${duration}" fps="${fps}" modifiedTime="${Date.now()}" amver="1028425" ffver="106" am="com.alightcreative.motion/5.0.273.1028425" amplatform="android" retime="freeze" retimeAdaptFPS="false">\n`;

        parsedBeats.forEach((ms) => {
            xmlStr += `  <bookmark t="${ms}" />\n`;
        });

        const centerX = (w / 2).toFixed(6);
        const centerY = (h / 2).toFixed(6);
        const randomId = Math.floor(Math.random() * 900000000) + 100000000;

        xmlStr += `  <shape id="${randomId}" label="placeholder" startTime="0" endTime="${duration}" fillType="color" mediaFillMode="fill" s=".rect">\n`;
        xmlStr += `    <transform>\n`;
        xmlStr += `      <location value="${centerX},${centerY},0.000000" />\n`;
        xmlStr += `      <scale value="5.400000,5.400000" />\n`;
        xmlStr += `    </transform>\n`;
        xmlStr += `    <fillColor value="#ff5f3a8e" />\n`;
        xmlStr += `    <property name="size" type="vec2" value="100.000000,100.000000" />\n`;
        xmlStr += `  </shape>\n`;
        xmlStr += `</scene>`;
        return xmlStr;
    }

    function convertAeToAmXml() {
        if (!selectedFile || foundCompositions.length === 0) return;

        const titleInput = document.getElementById('ae-am-title-input');
        const widthInput = document.getElementById('ae-am-width-input');
        const heightInput = document.getElementById('ae-am-height-input');
        const fpsInput = document.getElementById('ae-am-fps-input');
        const durationInput = document.getElementById('ae-am-duration-input');

        const title = (titleInput ? titleInput.value.trim() : '') || 'Project XML';
        const w = parseInt(widthInput?.value, 10) || 1080;
        const h = parseInt(heightInput?.value, 10) || 1920;
        const fps = parseInt(fpsInput?.value, 10) || 30;
        const duration = parseInt(durationInput?.value, 10) || 5000;

        if (parsedBeats.length === 0) {
            setButtonState('error', t('tool_ae_am_no_beats_alert') || "No beat markers found to convert.");
            return;
        }

        setButtonState('processing', "Generating Alight Motion XML...");

        try {
            const xmlStr = generateAmXml({ title, w, h, fps, duration, parsedBeats });
            const blob = new Blob([xmlStr], { type: 'text/xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_am.xml`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setButtonState('completed', t('status_process_another') || 'Process Another');

            if (typeof window.showToast === 'function') {
                window.showToast(t('tool_ae_am_success') || 'Alight Motion XML generated successfully!');
            }
        } catch (err) {
            console.error('[AE to AM] Conversion error:', err);
            setButtonState('error', 'Conversion failed');
        }
    }

    const toolDefinition = {
        id: 'tool-ae-am-beatmark',
        _id: 'tool-ae-am-beatmark',
        isTool: true,
        version: '1.0.0',
        title: 'AE to AM',
        titleKey: 'tool_ae_am_title',
        desc: 'Beatmark Converter',
        descKey: 'tool_ae_am_desc',
        dropKey: 'tool_ae_am_drop',
        icon: 'music_note',
        category: ['Converters', 'Tools'],
        features: [
            'Auto Hex `ldat` Marker Extraction',
            'Multi-composition detection & resolution parser',
            'Instant Alight Motion XML Bookmark Generation',
            '100% Client-side Browser Processing'
        ],
        specs: [
            { label: 'INPUT', value: 'After Effects Project XML' },
            { label: 'OUTPUT', value: 'Alight Motion XML' },
            { label: 'PROCESSING', value: 'Instant Client-side' }
        ],
        schema: {
            inputs: [
                {
                    id: 'file',
                    name: 'file',
                    type: 'file',
                    label: 'After Effects XML',
                    labelKey: 'tool_ae_am_drop',
                    subtitle: 'Supports After Effects (.xml)',
                    accept: ['.xml', '.aepx', 'text/xml', 'application/xml'],
                    required: true
                },
                {
                    id: 'title',
                    name: 'title',
                    type: 'text',
                    label: 'Project Title',
                    labelKey: 'tool_ae_am_project_title',
                    default: 'Project XML',
                    placeholder: 'Project XML'
                },
                {
                    id: 'fps',
                    name: 'fps',
                    type: 'select',
                    label: 'Frame Rate',
                    default: '30',
                    options: ['24', '25', '30', '60']
                }
            ]
        },
        run: async function(inputs, context = {}) {
            const file = inputs.file || selectedFile;
            if (!file) throw new Error('No AE XML file provided.');

            const onProgress = context.onProgress || (() => {});
            const onLog = context.onLog || (() => {});

            onProgress(15, 'Reading AE XML file...');
            onLog(`Reading ${file.name}...`);

            const text = await file.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, 'text/xml');
            if (!xmlDoc.querySelector('AfterEffectsProject')) {
                throw new Error("Invalid After Effects Project XML.");
            }

            const items = xmlDoc.querySelectorAll('Fold > Item');
            let targetComp = null;
            let targetCompName = '';
            items.forEach((item) => {
                const nameNode = item.querySelector('string');
                const hasLayers = item.querySelector('SLay') || item.querySelector('CLay');
                if (nameNode && hasLayers && !targetComp) {
                    targetComp = item;
                    targetCompName = nameNode.textContent;
                }
            });

            if (!targetComp) {
                throw new Error("No valid composition found in AE project.");
            }

            onProgress(50, 'Extracting markers and beats...');
            const { beats, detectedFps } = extractBeatsFromComp(targetComp);
            onLog(`Extracted ${beats.length} beats at ${detectedFps} FPS.`);

            const title = inputs.title || targetCompName || 'Project XML';
            const fps = parseInt(inputs.fps, 10) || detectedFps || 30;
            const w = parseInt(inputs.width, 10) || 1080;
            const h = parseInt(inputs.height, 10) || 1920;
            const lastBeat = beats.length > 0 ? beats[beats.length - 1] : 5000;
            const duration = lastBeat + Math.ceil(1000 / fps);

            onProgress(85, 'Generating Alight Motion XML...');
            const xmlStr = generateAmXml({ title, w, h, fps, duration, parsedBeats: beats });

            onProgress(100, 'Done!');
            onLog('Alight Motion XML ready.');

            return {
                type: 'file',
                data: new Blob([xmlStr], { type: 'text/xml' }),
                filename: `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_am.xml`,
                mimeType: 'text/xml'
            };
        },
        initModal: function(ctx) {
            initAeAmUI(ctx);
            selectedFile = null;
            foundCompositions = [];
            parsedBeats = [];
        },
        onFileSelect: function(file) {
            if (!file || !file.name.toLowerCase().endsWith('.xml')) {
                setButtonState('error', 'Please select an XML file');
                return;
            }
            selectedFile = file;
            parseAeFile(file);
        },
        onProcess: function() {
            convertAeToAmXml();
        },
        onReset: function() {
            selectedFile = null;
            foundCompositions = [];
            parsedBeats = [];
            const configSection = document.getElementById('ae-am-config-section');
            if (configSection) configSection.classList.add('hidden');
        }
    };

    if (window.AppTools && typeof window.AppTools.register === 'function') {
        window.AppTools.register(toolDefinition);
    } else {
        window._pendingTools = window._pendingTools || [];
        window._pendingTools.push(toolDefinition);
    }

    window.AeToAmBeatmarkTool = toolDefinition;
})();
