const SCRIPT_STORAGE_KEY = 'teleprompter-script';
const PREROLL_SECONDS = 3;
// Below this, the voice is ahead or behind by less than a line and the normal scroll
// already covers it; correcting anyway would jog the display on every spoken word.
const VOICE_DEADBAND = 0.01;

class TeleprompterController {
    constructor() {
        this.ws = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.currentPosition = 0;
        this.startTime = null;
        this.pausedTime = 0;
        this.segmentDuration = 10 * 60 * 1000;
        this.speed = 150;
        this.speedMultiplier = 1;
        this.fontSize = 48;
        this.readingLine = { enabled: false, position: 50, color: '#ffffff', thickness: 2 };
        this.timerInterval = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.isScrubbing = false;
        this.displayRatio = null;
        this.displayStateAt = 0;
        this.seekRaf = 0;
        this.prerollInterval = null;
        
        this.initializeElements();
        this.restoreSavedScript();
        this.bindEvents();
        this.connectWebSocket();
        this.initSpeedControl();
        this.initVoiceTracking();
        this.initEditor();
        this.initPreview();
        this.updateDurationCalculations();
        this.updateDisplayUrl();
        this.updateLanUrl();
    }
    
    initializeElements() {
        this.fileUpload = document.getElementById('file-upload');
        this.clearBtn = document.getElementById('clear-text');
        this.speedControl = document.getElementById('speed-control');
        this.speedDisplay = document.getElementById('speed-display');
        this.mirrorModeCheckbox = document.getElementById('mirror-mode');
        this.hideTimerCheckbox = document.getElementById('hide-timer');
        this.onAirModeCheckbox = document.getElementById('on-air-mode');
        this.fullscreenBtn = document.getElementById('fullscreen-display');
        this.voiceBtn = document.getElementById('voice-track');
        this.previewBox = document.getElementById('live-preview');
        this.previewFrame = document.getElementById('preview-frame');
        this.previewStage = document.getElementById('preview-stage');
        this.previewMirrorBtn = document.getElementById('preview-mirror');
        this.previewBadge = document.getElementById('preview-badge');
        this.scheduledStartInput = document.getElementById('scheduled-start');
        this.clearScheduleBtn = document.getElementById('clear-schedule');
        this.scheduleInfo = document.getElementById('schedule-info');
        this.playBtn = document.getElementById('play-btn');
        this.playIcon = this.playBtn?.querySelector('[data-play-icon]');
        this.playLabel = this.playBtn?.querySelector('[data-play-label]');
        this.resetBtn = document.getElementById('reset-btn');
        this.textPreview = document.getElementById('text-preview');
        this.wordCount = document.getElementById('word-count');
        this.expectedDuration = document.getElementById('expected-duration');
        this.segmentTimer = document.getElementById('segment-timer');
        this.elapsedTimer = document.getElementById('elapsed-timer');
        this.connectionStatus = document.getElementById('connection-status');
        this.statusIndicator = this.connectionStatus.querySelector('.status-indicator');
        this.statusText = this.connectionStatus.querySelector('.status-text');
        this.displayUrl = document.getElementById('display-url');
        this.copyUrlBtn = document.getElementById('copy-url');
        this.lanUrlRow = document.getElementById('lan-url-row');
        this.lanUrl = document.getElementById('lan-url');
        this.copyLanUrlBtn = document.getElementById('copy-lan-url');
        this.formatBtn = document.getElementById('format-text');
        this.autoFormatBtn = document.getElementById('auto-format');
        this.formatSettings = document.getElementById('format-settings');
        this.formatPanel = document.getElementById('format-panel');
        this.formatCapsCheckbox = document.getElementById('format-caps');
        this.formatSentencesCheckbox = document.getElementById('format-sentences');
        this.formatParagraphsCheckbox = document.getElementById('format-paragraphs');
        this.formatPunctuationCheckbox = document.getElementById('format-punctuation');
        this.readingLineBtn = document.getElementById('reading-line-btn');
        this.readingLineSettings = document.getElementById('reading-line-settings');
        this.readingLinePanel = document.getElementById('reading-line-panel');
        this.readingLinePosition = document.getElementById('reading-line-position');
        this.readingLineThickness = document.getElementById('reading-line-thickness');
        this.readingLineSwatches = document.getElementById('reading-line-swatches');
        this.exportTxtBtn = document.getElementById('export-txt');
        this.exportHtmlBtn = document.getElementById('export-html');
        this.progressBar = document.getElementById('script-progress');
        this.progressWrap = this.progressBar?.parentElement;
    }
    
    bindEvents() {
        this.fileUpload.addEventListener('change', (e) => this.handleFileUpload(e));
        this.clearBtn.addEventListener('click', () => this.clearText());
        this.exportTxtBtn.addEventListener('click', () => this.exportScript('txt'));
        this.exportHtmlBtn.addEventListener('click', () => this.exportScript('html'));
        this.mirrorModeCheckbox.addEventListener('change', (e) => this.updateMirrorMode(e.target.checked));
        this.hideTimerCheckbox.addEventListener('change', (e) => this.updateHideTimer(e.target.checked));
        this.onAirModeCheckbox.addEventListener('change', (e) => this.updateOnAir(e.target.checked));
        this.fullscreenBtn.addEventListener('click', () => this.toggleDisplayFullscreen());
        this.bindReadingLine();
        this.bindFormatControl();
        this.previewMirrorBtn?.addEventListener('click', () => this.togglePreviewMirror());
        document.querySelector('.display-toggles')?.addEventListener('focusin', () => this.pinShell());
        this.scheduledStartInput.addEventListener('change', () => this.updateScheduledStart());
        this.clearScheduleBtn.addEventListener('click', () => this.clearScheduledStart());
        this.playBtn.addEventListener('click', () => this.togglePlayback());
        this.bindHotkeys();
        this.resetBtn.addEventListener('click', () => this.reset());
        this.copyUrlBtn.addEventListener('click', () => this.copyDisplayUrl());
        this.copyLanUrlBtn?.addEventListener('click', () => this.copyLanUrl());
        this.formatBtn.addEventListener('click', () => this.formatTextForTeleprompter());
        this.bindProgressBar();
        
        this.textPreview.addEventListener('input', () => {
            this.sendTextUpdate();
            this.updateDurationCalculations();
        });
        
        // Prevent form submission on enter
        this.textPreview.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                this.start();
            }
        });
    }

    initSpeedControl() {
        this.speedWidget = new SpeedControl({
            slider: this.speedControl,
            display: this.speedDisplay,
            primaryRoot: document.getElementById('speed-presets-primary'),
            wpmHint: document.getElementById('speed-wpm'),
            onChange: (wpm, multiplier) => this.updateSpeed(wpm, multiplier)
        });
    }

    initEditor() {
        this.textPreview.style.fontSize = `${this.fontSize}px`;
        this.editorToolbar = new EditorToolbar({
            editor: this.textPreview,
            toolbar: document.getElementById('editor-toolbar'),
            findBar: document.getElementById('editor-find'),
            onChange: () => {
                this.sendTextUpdate();
                this.updateDurationCalculations();
            },
            onFontSize: (size) => this.updateFontSize(size)
        });
    }

    // The thumbnail runs display.html itself at 1280x720 and scales it down, so it is a
    // picture of the wall rather than a second layout to keep in sync.
    initPreview() {
        if (!this.previewBox || !this.previewFrame) return;
        const nativeW = 1280;
        const nativeH = 720;
        const fit = () => {
            const w = this.previewBox.clientWidth;
            const h = this.previewBox.clientHeight;
            if (!w || !h) return;
            const scale = Math.min(w / nativeW, h / nativeH);
            this.previewFrame.style.transform = `scale(${scale})`;
            this.previewFrame.style.left = `${(w - nativeW * scale) / 2}px`;
            this.previewFrame.style.top = `${(h - nativeH * scale) / 2}px`;
        };
        new ResizeObserver(fit).observe(this.previewBox);
        this.previewFrame.addEventListener('load', fit);
        fit();
    }

    togglePreviewMirror() {
        if (!this.previewStage || !this.previewMirrorBtn) return;
        const next = this.previewMirrorBtn.getAttribute('aria-pressed') !== 'true';
        this.previewMirrorBtn.setAttribute('aria-pressed', String(next));
        this.previewStage.classList.toggle('is-mirrored', next);
    }

    updatePreviewBadge() {
        if (!this.previewBadge) return;
        this.previewBadge.textContent = this.isPlaying ? 'SCROLL' : 'PAUSED';
        this.previewBadge.classList.toggle('is-live', this.isPlaying);
    }

    exportScript(format) {
        const isHtml = format === 'html';
        const content = isHtml ? this.textPreview.innerHTML : (this.textPreview.innerText || '');
        const blob = new Blob([content], { type: isHtml ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `script.${isHtml ? 'html' : 'txt'}`;
        link.click();
        URL.revokeObjectURL(url);
    }
    
    connectWebSocket() {
        try {
            this.updateConnectionStatus('connecting', 'Connecting...');
            // Construct WebSocket URL dynamically based on current location
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsPort = window.location.port || (window.location.protocol === 'https:' ? 443 : 80);
            const wsUrl = `${wsProtocol}//${window.location.hostname}:${wsPort}`;
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('Connected to WebSocket server');
                this.updateConnectionStatus('connected', 'Connected');
                this.reconnectAttempts = 0;
                
                // Register as controller. The server answers with stateSync; whether we
                // adopt the running show or seed it is decided there, not here.
                this.ws.send(JSON.stringify({
                    type: 'register',
                    role: 'controller'
                }));
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket connection closed');
                this.updateConnectionStatus('disconnected', 'Disconnected');
                this.scheduleReconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateConnectionStatus('disconnected', 'Connection Error');
            };
            
        } catch (error) {
            console.error('Failed to connect to WebSocket:', error);
            this.updateConnectionStatus('disconnected', 'Failed to Connect');
            this.scheduleReconnect();
        }
    }
    
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            this.updateConnectionStatus('connecting', `Reconnecting in ${Math.ceil(delay / 1000)}s...`);
            
            setTimeout(() => {
                this.connectWebSocket();
            }, delay);
        } else {
            this.updateConnectionStatus('disconnected', 'Max reconnect attempts reached');
        }
    }
    
    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }
    
    // On a refresh the server still holds the running show, so take its state back
    // instead of overwriting it with the page's blank defaults.
    adoptState(state) {
        if (state.text) {
            this.textPreview.innerHTML = state.text;
            this.saveScript(state.text);
        }
        if (Number.isFinite(state.fontSize)) {
            this.fontSize = state.fontSize;
            this.textPreview.style.fontSize = `${this.fontSize}px`;
        }
        if (Number.isFinite(state.speed)) {
            this.speed = state.speed;
            this.speedMultiplier = state.speedMultiplier || state.speed / 150;
            this.speedWidget?.setMultiplier(this.speedMultiplier, { silent: true });
        }
        this.mirrorModeCheckbox.checked = !!state.mirrorMode;
        this.hideTimerCheckbox.checked = !!state.hideTimer;
        this.onAirModeCheckbox.checked = !!state.onAir;
        if (state.readingLine) this.applyReadingLineControls(state.readingLine);
        this.editorToolbar?.syncBookmarkCount();
        this.updateDurationCalculations();
        this.adoptPlayback(state);
    }

    // Playback lives on the server and the display. After a refresh the page is idle
    // even though the show is still rolling — take the clocks back, do not send start.
    adoptPlayback(state) {
        this.isPlaying = !!state.isPlaying;
        this.isPaused = !this.isPlaying && !!state.isPaused;
        this.startTime = Number.isFinite(state.startTime) ? state.startTime : null;
        this.pausedTime = Number.isFinite(state.pausedTime) ? state.pausedTime : 0;
        if (Number.isFinite(state.segmentLength)) {
            this.segmentDuration = Math.max(1000, state.segmentLength * 1000);
        }
        const ratio = Number(state.progressRatio);
        if (Number.isFinite(ratio)) {
            this.displayRatio = Math.min(1, Math.max(0, ratio));
            this.displayStateAt = Date.now();
        }
        this.syncPlayButton();
        if (this.isPlaying) this.startTimer();
        else {
            this.stopTimer();
            this.updateDisplay();
        }
    }

    // Second line of defence: the server can restart, the browser keeps the script.
    saveScript(html) {
        try {
            localStorage.setItem(SCRIPT_STORAGE_KEY, html);
        } catch {
            /* private mode */
        }
    }

    restoreSavedScript() {
        try {
            const saved = localStorage.getItem(SCRIPT_STORAGE_KEY);
            if (saved) this.textPreview.innerHTML = saved;
        } catch {
            /* private mode */
        }
    }

    sendInitialState() {
        // Send current text content
        this.sendTextUpdate();
        
        // Send all current settings
        this.sendMessage({ type: 'setSpeed', value: this.speed, multiplier: this.speedMultiplier });
        this.sendMessage({ type: 'setFontSize', value: this.fontSize });
        this.updateDurationCalculations();
        this.sendMessage({ type: 'setMirrorMode', enabled: this.mirrorModeCheckbox.checked });
        this.sendMessage({ type: 'setHideTimer', enabled: this.hideTimerCheckbox.checked });
        this.sendMessage({ type: 'setOnAir', enabled: this.onAirModeCheckbox.checked });
        this.sendReadingLine();
        
        // Send scheduled start if set
        if (this.scheduledStartInput.value) {
            this.updateScheduledStart();
        }
    }
    
    handleMessage(data) {
        switch (data.type) {
            case 'stateSync':
                if (data.state && (data.state.text || data.state.isPlaying || data.state.isPaused)) {
                    this.adoptState(data.state);
                } else {
                    this.sendInitialState();
                }
                break;
                
            case 'pong':
                // Heartbeat response
                break;
                
            case 'connectionCount':
                this.updateConnectionInfo(data);
                break;
                
            case 'fullscreenState':
                this.setFullscreenPressed(data.enabled);
                break;
                
            case 'progress':
                if (this.isScrubbing) break;
                this.displayRemaining = Math.max(0, Number(data.remainingMs) || 0);
                if (Number.isFinite(data.ratio)) {
                    this.displayRatio = Math.min(1, Math.max(0, data.ratio));
                }
                this.displayStateAt = Date.now();
                this.updateDisplay();
                break;
                
            default:
                console.log('Unknown message type:', data.type);
        }
    }
    
    toggleDisplayFullscreen() {
        this.pinShell();
        const next = this.fullscreenBtn.getAttribute('aria-pressed') !== 'true';
        this.setFullscreenPressed(next);
        this.sendMessage({ type: 'setFullscreen', enabled: next });
    }

    // The display reports what actually happened - Escape and refusals included.
    setFullscreenPressed(enabled) {
        this.fullscreenBtn.setAttribute('aria-pressed', String(!!enabled));
    }

    bindReadingLine() {
        if (!this.readingLineBtn) return;
        this.readingLineBtn.addEventListener('click', () => {
            this.readingLine.enabled = !this.readingLine.enabled;
            this.syncReadingLineControls();
            this.sendReadingLine();
        });
        this.readingLineSettings?.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = this.readingLinePanel.hidden;
            this.readingLinePanel.hidden = !open;
            this.readingLineSettings.setAttribute('aria-expanded', String(open));
        });
        this.readingLinePosition?.addEventListener('input', () => {
            this.readingLine.position = Number(this.readingLinePosition.value);
            this.syncReadingLineControls();
            this.sendReadingLine();
        });
        this.readingLineThickness?.addEventListener('input', () => {
            this.readingLine.thickness = Number(this.readingLineThickness.value);
            this.syncReadingLineControls();
            this.sendReadingLine();
        });
        this.readingLineSwatches?.addEventListener('click', (e) => {
            const swatch = e.target.closest('[data-color]');
            if (!swatch) return;
            this.readingLine.color = swatch.dataset.color;
            this.syncReadingLineControls();
            this.sendReadingLine();
        });
        document.addEventListener('click', (e) => {
            if (!this.readingLinePanel || this.readingLinePanel.hidden) return;
            if (e.target.closest('.display-line-control')) return;
            this.readingLinePanel.hidden = true;
            this.readingLineSettings?.setAttribute('aria-expanded', 'false');
        });
        this.syncReadingLineControls();
    }

    bindFormatControl() {
        if (!this.autoFormatBtn) return;
        this.autoFormatBtn.addEventListener('click', () => {
            const on = this.autoFormatBtn.getAttribute('aria-pressed') !== 'true';
            this.autoFormatBtn.setAttribute('aria-pressed', String(on));
        });
        this.formatSettings?.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = this.formatPanel.hidden;
            this.formatPanel.hidden = !open;
            this.formatSettings.setAttribute('aria-expanded', String(open));
        });
        document.addEventListener('click', (e) => {
            if (!this.formatPanel || this.formatPanel.hidden) return;
            if (e.target.closest('.editor-format-control')) return;
            this.formatPanel.hidden = true;
            this.formatSettings?.setAttribute('aria-expanded', 'false');
        });
    }

    applyReadingLineControls(line) {
        this.readingLine = {
            enabled: !!line.enabled,
            position: Math.min(80, Math.max(20, Number(line.position) || 50)),
            color: line.color || '#ffffff',
            thickness: Math.min(8, Math.max(1, Number(line.thickness) || 2))
        };
        this.syncReadingLineControls();
    }

    syncReadingLineControls() {
        const { enabled, position, color, thickness } = this.readingLine;
        this.readingLineBtn?.setAttribute('aria-pressed', String(enabled));
        if (this.readingLinePosition) this.readingLinePosition.value = String(position);
        if (this.readingLineThickness) this.readingLineThickness.value = String(thickness);
        const posLabel = document.getElementById('reading-line-pos-label');
        const thickLabel = document.getElementById('reading-line-thick-label');
        if (posLabel) posLabel.textContent = `${position}%`;
        if (thickLabel) thickLabel.textContent = `${thickness}px`;
        this.readingLineSwatches?.querySelectorAll('[data-color]').forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.color === color);
        });
    }

    sendReadingLine() {
        this.sendMessage({ type: 'setReadingLine', ...this.readingLine });
    }

    updateConnectionInfo(data) {
        // Update connection status display with count info
        const totalConnections = data.controllers + data.displays;
        // A silently ignored display would be its own kind of confusing: the bar behaves
        // while that window still crawls, so name it here where the operator looks.
        const stale = data.stale ? `, ${data.stale} outdated - reload` : '';
        const displayText = `Connected (${data.displays} display${data.displays !== 1 ? 's' : ''}${stale})`;
        this.updateConnectionStatus('connected', displayText);
        this.displayCount = data.displays;
        if (!this.displayCount) {
            this.displayRemaining = null;
            this.displayRatio = null;
        }
    }
    
    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
            let text = '';
            
            if (file.type === 'text/plain') {
                text = await this.readTextFile(file);
            } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                       file.name.toLowerCase().endsWith('.docx')) {
                text = await this.readWordDocument(file);
            } else if (file.type.includes('word') || file.name.toLowerCase().endsWith('.doc')) {
                alert('Legacy .doc files are not supported. Please use .docx format or convert to text.');
                return;
            } else {
                text = await this.readTextFile(file);
            }
            
            this.setPrompterText(text);
        } catch (error) {
            alert('Error reading file: ' + error.message);
        }
    }
    
    readTextFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }
    
    readWordDocument(file) {
        return new Promise((resolve, reject) => {
            if (typeof mammoth === 'undefined') {
                reject(new Error('Mammoth library not loaded. Please refresh the page.'));
                return;
            }
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const result = await mammoth.extractRawText({arrayBuffer: arrayBuffer});
                    
                    if (result.messages && result.messages.length > 0) {
                        console.warn('Word document conversion warnings:', result.messages);
                    }
                    
                    resolve(result.value);
                } catch (error) {
                    reject(new Error('Failed to parse Word document: ' + error.message));
                }
            };
            reader.onerror = (e) => reject(new Error('Failed to read Word document'));
            reader.readAsArrayBuffer(file);
        });
    }
    
    setPrompterText(text) {
        if (this.autoFormatBtn?.getAttribute('aria-pressed') === 'true') {
            text = this.formatTextForTeleprompterStandards(text);
        }
        this.textPreview.innerHTML = this.plainTextToHtml(text);
        this.sendTextUpdate();
        this.updateDurationCalculations();
    }
    
    sendTextUpdate() {
        const editor = this.textPreview;
        const computed = window.getComputedStyle(editor);
        this.saveScript(editor.innerHTML);
        this.voiceTracker?.setScript(this.getEditorPlainText());
        this.sendMessage({
            type: 'setText',
            content: editor.innerHTML,
            styles: {
                fontSize: editor.style.fontSize || '',
                textAlign: editor.style.textAlign || computed.textAlign || '',
                fontWeight: editor.style.fontWeight || '',
                fontStyle: editor.style.fontStyle || ''
            }
        });
    }
    
    clearText() {
        this.textPreview.innerHTML = '<p>Upload your manuscript or type your text here...</p>';
        this.sendTextUpdate();
        this.reset();
        this.updateDurationCalculations();
    }
    
    updateSpeed(value, multiplier) {
        this.speed = parseInt(value, 10);
        this.speedMultiplier = Number(multiplier) || this.speed / 150;
        this.sendMessage({ type: 'setSpeed', value: this.speed, multiplier: this.speedMultiplier });
        this.updateDurationCalculations();
    }

    isTypingTarget(el) {
        return !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
    }

    bindHotkeys() {
        document.addEventListener('keydown', (e) => {
            if (this.isTypingTarget(e.target)) return;
            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlayback();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.speedWidget?.nudge(0.1);
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.speedWidget?.nudge(-0.1);
                return;
            }
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const now = this.displayRatio != null
                    ? this.displayRatio
                    : this.progressFromClocks(
                        this.startTime ? Date.now() - this.startTime : this.pausedTime,
                        this.displayRemaining ?? this.segmentDuration
                    );
                this.seekToRatio(now + (e.key === 'ArrowRight' ? 0.02 : -0.02));
                return;
            }
            if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                this.reset();
            }
        });
    }
    
    updateFontSize(value) {
        this.fontSize = parseInt(value, 10);
        this.textPreview.style.fontSize = `${this.fontSize}px`;
        this.sendMessage({ type: 'setFontSize', value: this.fontSize });
    }
    
    pinShell() {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        document.querySelector('.controller-container')?.scrollTo(0, 0);
        document.querySelector('.controller-content')?.scrollTo(0, 0);
    }

    updateMirrorMode(enabled) {
        this.pinShell();
        this.sendMessage({ type: 'setMirrorMode', enabled: enabled });
    }
    
    updateHideTimer(enabled) {
        this.pinShell();
        this.sendMessage({ type: 'setHideTimer', enabled: enabled });
    }
    
    updateOnAir(enabled) {
        this.pinShell();
        this.sendMessage({ type: 'setOnAir', enabled: enabled });
    }
    
    updateScheduledStart() {
        const scheduledTime = this.scheduledStartInput.value;
        if (scheduledTime) {
            const scheduledDate = new Date(scheduledTime);
            const now = new Date();
            
            if (scheduledDate <= now) {
                alert('Scheduled time must be in the future');
                this.scheduledStartInput.value = '';
                return;
            }
            
            this.scheduleInfo.innerHTML = `<span>Scheduled for: ${scheduledDate.toLocaleString()}</span>`;
            this.sendMessage({ 
                type: 'setScheduledStart', 
                scheduledTime: scheduledDate.getTime() 
            });
        } else {
            this.clearScheduledStart();
        }
    }
    
    clearScheduledStart() {
        this.scheduledStartInput.value = '';
        this.scheduleInfo.innerHTML = '<span>No scheduled start time set</span>';
        this.sendMessage({ type: 'clearScheduledStart' });
    }
    
    togglePlayback() {
        if (this.prerollInterval) {
            this.cancelPreroll();
            return;
        }
        this.isPlaying ? this.pause() : this.start();
    }

    // The displays run the count themselves; the controller only says how long it is and
    // starts for real when it runs out.
    runPreroll() {
        let left = PREROLL_SECONDS;
        this.sendMessage({ type: 'preroll', seconds: left });
        this.showPrerollOnButton(left);
        this.prerollInterval = setInterval(() => {
            left -= 1;
            if (left > 0) {
                this.showPrerollOnButton(left);
                return;
            }
            clearInterval(this.prerollInterval);
            this.prerollInterval = null;
            this.start(true);
        }, 1000);
    }

    cancelPreroll() {
        if (!this.prerollInterval) return;
        clearInterval(this.prerollInterval);
        this.prerollInterval = null;
        this.sendMessage({ type: 'preroll', seconds: 0 });
        this.syncPlayButton();
    }

    showPrerollOnButton(left) {
        if (this.playIcon) this.playIcon.textContent = String(left);
        if (this.playLabel) this.playLabel.textContent = 'Starting';
    }

    syncPlayButton() {
        if (!this.playBtn) return;
        const playing = this.isPlaying;
        this.playBtn.classList.toggle('start', !playing);
        this.playBtn.classList.toggle('pause', playing);
        this.playBtn.setAttribute('aria-pressed', String(playing));
        this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Start');
        if (this.playIcon) this.playIcon.textContent = playing ? '⏸' : '▶';
        if (this.playLabel) this.playLabel.textContent = playing ? 'Pause' : 'Start';
        this.updatePreviewBadge();
    }

    start(afterPreroll = false) {
        if (!afterPreroll && this.isAtEnd()) this.rewindForReplay();
        if (this.isPaused) {
            this.resume();
            return;
        }
        if (!afterPreroll && !this.prerollInterval) {
            this.runPreroll();
            return;
        }
        
        this.isPlaying = true;
        this.isPaused = false;
        this.startTime = Date.now() - (this.pausedTime || 0);
        
        this.onAirModeCheckbox.checked = true;
        this.syncPlayButton();
        
        this.sendPlayback('start');
        this.startTimer();
    }
    
    isAtEnd() {
        if (this.displayRemaining != null && this.displayRemaining <= 250) return true;
        return this.displayRatio != null && this.displayRatio >= 0.99;
    }

    rewindForReplay() {
        this.isPlaying = false;
        this.isPaused = false;
        this.startTime = null;
        this.pausedTime = 0;
        this.currentPosition = 0;
        this.displayRemaining = null;
        this.displayRatio = 0;
        this.displayStateAt = 0;
        this.voiceTracker?.setRatio(0);
        this.sendMessage({ type: 'reset' });
        this.stopTimer();
        this.updateProgressBar(0);
    }

    pause() {
        this.isPaused = true;
        this.isPlaying = false;
        this.pausedTime = Date.now() - this.startTime;
        
        this.syncPlayButton();
        this.sendPlayback('pause');
        this.stopTimer();
        this.updateDisplay();
    }
    
    resume() {
        this.isPlaying = true;
        this.isPaused = false;
        this.startTime = Date.now() - this.pausedTime;
        
        this.syncPlayButton();
        this.sendPlayback('start');
        this.startTimer();
    }

    sendPlayback(type) {
        this.sendMessage({
            type,
            startTime: this.startTime,
            pausedTime: this.pausedTime || 0,
            segmentDuration: this.segmentDuration
        });
    }
    
    reset() {
        this.cancelPreroll();
        this.voiceTracker?.setRatio(0);
        this.isPlaying = false;
        this.isPaused = false;
        this.currentPosition = 0;
        this.startTime = null;
        this.pausedTime = 0;
        
        this.syncPlayButton();
        
        this.displayRemaining = null;
        this.displayRatio = 0;
        this.sendMessage({ type: 'reset' });
        this.stopTimer();
        this.updateDisplay();
    }
    
    startTimer() {
        this.stopTimer();
        this.updateDisplay();
        this.timerInterval = setInterval(() => this.updateDisplay(), 200);
    }
    
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }
    
    updateDisplay() {
        const elapsed = this.startTime ? Date.now() - this.startTime : this.pausedTime;
        // A prompting display reports the time left from its own scroll position; the wall
        // clock is only a fallback for when no display is connected.
        const remaining = this.displayRemaining != null && this.displayStateIsFresh()
            ? this.displayRemaining
            : Math.max(0, this.segmentDuration - elapsed);
        
        this.updateCountdownDisplay(remaining);
        this.updateElapsedDisplay(elapsed);
        this.updateProgressBar(this.progressFromClocks(elapsed, remaining));
        this.updatePreviewBadge();
        
        if (remaining <= 0 && this.isPlaying && this.displayRemaining != null && this.displayStateIsFresh()) {
            this.pause();
        }
    }
    
    updateCountdownDisplay(remaining = this.segmentDuration) {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        
        this.segmentTimer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    updateElapsedDisplay(elapsed) {
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        
        this.elapsedTimer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    bindProgressBar() {
        if (!this.progressBar) return;
        const seekFromInput = () => this.seekToRatio(Number(this.progressBar.value) / 1000);
        this.progressBar.addEventListener('pointerdown', () => { this.isScrubbing = true; });
        this.progressBar.addEventListener('pointerup', () => { this.isScrubbing = false; seekFromInput(); });
        this.progressBar.addEventListener('pointercancel', () => { this.isScrubbing = false; });
        this.progressBar.addEventListener('input', () => {
            this.isScrubbing = true;
            const ratio = Number(this.progressBar.value) / 1000;
            this.updateProgressBar(ratio);
            if (this.seekRaf) return;
            this.seekRaf = requestAnimationFrame(() => {
                this.seekRaf = 0;
                this.seekToRatio(Number(this.progressBar.value) / 1000);
            });
        });
        this.progressBar.addEventListener('change', () => {
            this.isScrubbing = false;
            seekFromInput();
        });
    }

    // A display's report is the truth while it keeps arriving. A seek writes an
    // optimistic one, so while playing it has to be refreshed or the countdown and the
    // bar sit frozen where the scrub dropped them; paused, the last report still stands.
    displayStateIsFresh() {
        return !this.isPlaying || Date.now() - this.displayStateAt < 1500;
    }

    progressFromClocks(elapsed, remaining) {
        if (this.displayRatio != null && this.displayStateIsFresh()) return this.displayRatio;
        const total = this.segmentDuration || 1;
        if (this.displayRemaining != null) return Math.min(1, Math.max(0, 1 - remaining / total));
        return Math.min(1, Math.max(0, elapsed / total));
    }

    updateProgressBar(ratio) {
        if (!this.progressBar || (this.isScrubbing && ratio !== Number(this.progressBar.value) / 1000)) return;
        const safe = Math.min(1, Math.max(0, Number(ratio) || 0));
        this.progressBar.value = String(Math.round(safe * 1000));
        if (this.progressWrap) this.progressWrap.style.setProperty('--progress', `${(safe * 100).toFixed(2)}%`);
    }

    initVoiceTracking() {
        if (!this.voiceBtn) return;
        if (!VoiceTracker.isSupported()) {
            this.voiceBtn.disabled = true;
            this.voiceBtn.title = 'Voice tracking needs Chrome or Edge';
            return;
        }
        this.voiceTracker = new VoiceTracker({
            onPosition: (ratio) => this.applyVoiceRatio(ratio),
            onState: (listening, message) => {
                this.voiceBtn.setAttribute('aria-pressed', String(listening));
                this.voiceBtn.classList.toggle('is-listening', listening);
                if (message) alert(message);
            }
        });
        this.voiceTracker.setScript(this.getEditorPlainText());
        this.voiceBtn.addEventListener('click', () => this.toggleVoiceTracking());
    }

    toggleVoiceTracking() {
        this.pinShell();
        if (!this.voiceTracker) return;
        if (this.voiceTracker.active) {
            this.voiceTracker.stop();
            return;
        }
        this.voiceTracker.setScript(this.getEditorPlainText());
        this.voiceTracker.setRatio(this.displayRatio || 0);
        this.voiceTracker.start();
    }

    // The voice corrects the scroll, it does not drive it: between corrections the normal
    // playback keeps the motion smooth, so only real drift is worth a jump.
    applyVoiceRatio(ratio) {
        const current = this.displayRatio ?? 0;
        if (Math.abs(ratio - current) < VOICE_DEADBAND) return;
        this.seekToRatio(ratio, true);
    }

    seekToRatio(ratio, fromVoice = false) {
        const safe = Math.min(1, Math.max(0, Number(ratio) || 0));
        if (!fromVoice) this.voiceTracker?.setRatio(safe);
        const elapsed = Math.round(safe * this.segmentDuration);
        this.pausedTime = elapsed;
        this.displayRatio = safe;
        this.displayStateAt = Date.now();
        this.displayRemaining = Math.max(0, this.segmentDuration - elapsed);
        if (this.isPlaying) {
            this.startTime = Date.now() - elapsed;
        } else if (elapsed > 0 || this.startTime) {
            this.startTime = Date.now() - elapsed;
            this.isPaused = elapsed > 0;
        }
        this.sendMessage({
            type: 'seek',
            ratio: safe,
            playing: this.isPlaying,
            startTime: this.startTime,
            pausedTime: elapsed,
            segmentDuration: this.segmentDuration
        });
        this.updateCountdownDisplay(this.displayRemaining);
        this.updateElapsedDisplay(elapsed);
        this.updateProgressBar(safe);
    }
    
    updateDurationCalculations() {
        const wordCount = this.getWordCount();
        const expectedDurationMs = Math.max(1000, this.calculateExpectedDuration(wordCount));
        this.segmentDuration = expectedDurationMs;
        this.wordCount.textContent = wordCount.toLocaleString();
        this.expectedDuration.textContent = this.formatDuration(expectedDurationMs);
        const totalSeconds = Math.round(expectedDurationMs / 1000);
        if (this.lastSentDuration !== totalSeconds) {
            this.lastSentDuration = totalSeconds;
            this.sendMessage({
                type: 'setSegmentLength',
                minutes: Math.floor(totalSeconds / 60),
                seconds: totalSeconds % 60,
                totalSeconds
            });
        }
        if (!this.isPlaying) this.updateDisplay();
    }
    
    getWordCount() {
        const text = this.textPreview.textContent || this.textPreview.innerText || '';
        const words = text.trim().split(/\s+/).filter(word => word.length > 0);
        return words.length;
    }
    
    calculateExpectedDuration(wordCount) {
        return Math.round((wordCount / this.speed) * 60 * 1000);
    }
    
    formatDuration(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    updateConnectionStatus(status, text) {
        this.statusIndicator.className = `status-indicator ${status}`;
        this.statusText.textContent = text;
    }
    
    updateDisplayUrl() {
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = window.location.port ? `:${window.location.port}` : '';
        const displayUrl = `${protocol}//${hostname}${port}/display.html`;
        this.displayUrl.textContent = displayUrl;
    }
    
    // The address this page was opened on is by definition one that works from another
    // machine - unless it is loopback. Asking the server is only worth it in that case,
    // and a containerised server cannot answer: it sees its own bridge network, not the
    // host's wifi, so its addresses reach nothing from a phone.
    async updateLanUrl() {
        if (!this.lanUrlRow) return;
        const loopback = ['localhost', '127.0.0.1', '[::1]', '::1', ''];
        let host = loopback.includes(window.location.hostname) ? '' : window.location.host;
        let others = [];

        if (!host) {
            try {
                const response = await fetch('/api/lan');
                const { addresses = [], port, container } = await response.json();
                if (!container && addresses[0]) {
                    host = `${addresses[0]}:${port}`;
                    others = addresses;
                }
            } catch {
                /* older server, or no network */
            }
        }
        if (!host) return;

        this.lanControllerUrl = `${window.location.protocol}//${host}/controller.html`;
        this.lanUrl.textContent = this.lanControllerUrl;
        if (others.length > 1) this.lanUrl.title = `This machine is also on: ${others.join(', ')}`;
        this.lanUrlRow.hidden = false;
    }

    copyLanUrl() {
        if (!this.lanControllerUrl) return;
        this.copyToClipboard(this.lanControllerUrl, this.copyLanUrlBtn);
    }

    copyToClipboard(text, button) {
        const done = () => {
            const label = button.textContent;
            button.textContent = 'Copied!';
            setTimeout(() => {
                button.textContent = label;
            }, 2000);
        };
        navigator.clipboard.writeText(text).then(done).catch(() => {
            // Fallback for browsers that don't support clipboard API
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            done();
        });
    }

    copyDisplayUrl() {
        this.copyToClipboard(this.displayUrl.textContent, this.copyUrlBtn);
    }
    
    formatTextForTeleprompter() {
        const currentText = this.getEditorPlainText();
        if (!currentText.trim()) {
            alert('No text to format. Please upload a manuscript or enter text first.');
            return;
        }
        
        const formattedText = this.formatTextForTeleprompterStandards(currentText);
        this.setPrompterTextDirectly(formattedText);
    }

    getEditorPlainText() {
        return (this.textPreview.innerText || this.textPreview.textContent || '')
            .replace(/\r\n/g, '\n')
            .replace(/\u00a0/g, ' ');
    }

    escapePlainText(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // HTML collapses runs of spaces and drops them at line edges, so pin them with
    // non-breaking spaces; one plain space per run keeps the line able to wrap.
    plainTextToHtml(text) {
        return this.escapePlainText(text)
            .split('\n')
            .map((line) => line
                .replace(/\t/g, '    ')
                .replace(/ {2,}/g, (run) => '&nbsp;'.repeat(run.length - 1) + ' ')
                .replace(/^ /, '&nbsp;')
                .replace(/ $/, '&nbsp;'))
            .join('<br>');
    }
    
    setPrompterTextDirectly(text) {
        this.textPreview.innerHTML = this.plainTextToHtml(text);
        this.sendTextUpdate();
        this.updateDurationCalculations();
    }
    
    formatTextForTeleprompterStandards(text) {
        let formattedText = text;
        
        // Apply selected formatting options
        if (this.formatCapsCheckbox.checked) {
            formattedText = this.convertToUppercase(formattedText);
        }
        
        if (this.formatPunctuationCheckbox.checked) {
            formattedText = this.enhancePunctuationPauses(formattedText);
        }
        
        if (this.formatSentencesCheckbox.checked) {
            formattedText = this.formatSentenceBreaks(formattedText);
        }
        
        if (this.formatParagraphsCheckbox.checked) {
            formattedText = this.addParagraphBreaks(formattedText);
        }
        
        return formattedText;
    }
    
    convertToUppercase(text) {
        return text.toUpperCase();
    }
    
    enhancePunctuationPauses(text) {
        return text.replace(/([.,;:?!])(?![\s\n])/g, '$1 ');
    }
    
    formatSentenceBreaks(text) {
        return text.replace(/([.!?])[ \t]+/g, '$1\n');
    }
    
    addParagraphBreaks(text) {
        // A line carrying only spaces counts as blank; any run of breaks becomes one blank line.
        return text.replace(/^[ \t]+$/gm, '').replace(/\n{2,}/g, '\n\n');
    }
}

// Initialize controller when page loads
document.addEventListener('DOMContentLoaded', () => {
    new TeleprompterController();
});