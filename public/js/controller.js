// A session per show. Two operators on one server are two separate broadcasts, and the
// id in the URL is what ties a display to its own controller rather than to whoever is
// prompting next door. Opening the controller without one starts a new session, so they
// come into being simply by someone opening the page.
const SESSION_PATH = /^\/(?:d\/)?([a-zA-Z0-9_-]{1,40})$/;

function sessionFromLocation() {
    const fromQuery = new URLSearchParams(location.search).get('s');
    if (fromQuery) return fromQuery;
    if (location.pathname.includes('.')) return '';
    return SESSION_PATH.exec(location.pathname)?.[1] || '';
}

function currentSessionId() {
    const existing = sessionFromLocation();
    if (existing) return existing;

    // randomUUID needs a secure context and a studio runs this over plain http on the
    // local network, so it cannot be the only source of an id.
    const id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2))
        .replace(/-/g, '')
        .slice(0, 8);
    history.replaceState(null, '', `/${id}`);
    return id;
}

const SCRIPT_STORAGE_KEY = 'teleprompter-script';

// Both caches are keyed per session. One browser can run several shows, and a single
// shared key meant a brand new session opened with the previous one's script already in
// the editor - somebody else's copy, on somebody else's prompter.
const scriptCacheKey = (sessionId) => `${SCRIPT_STORAGE_KEY}:${sessionId}`;

// The unkeyed keys are what those shared caches used to live under: drop them once, so
// no old copy of a script lingers in the browser.
function dropSharedCaches() {
    try {
        localStorage.removeItem(SCRIPT_STORAGE_KEY);
        localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch {
        /* private mode */
    }
}
const SETTINGS_STORAGE_KEY = 'teleprompter-settings';

// Keyed per session: one browser can run several shows, and a cache shared between them
// would flash the neighbour's name in the header before the server answers.
const settingsCacheKey = (sessionId) => `${SETTINGS_STORAGE_KEY}:${sessionId}`;
const PREROLL_SECONDS = 3;
// Below this, the voice is ahead or behind by less than a line and the normal scroll
// already covers it; correcting anyway would jog the display on every spoken word.
const VOICE_DEADBAND = 0.01;

class TeleprompterController {
    constructor() {
        this.sessionId = currentSessionId();
        dropSharedCaches();
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
        this.lineHeight = 1.6;
        this.readingLine = { enabled: false, style: 'none', lastStyle: 'line', position: 50, color: '#ffffff', thickness: 2, size: 28, side: 'left' };
        this.timerInterval = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.isScrubbing = false;
        this.displayRatio = null;
        this.displayStateAt = 0;
        this.seekRaf = 0;
        this.prerollInterval = null;
        this.settings = { name: document.title, lang: '', uiLang: resolveUiLang(), showProgress: false, progressPosition: 'hidden' };
        this.restoreSavedSettings();
        this.scheduledAt = null;
        this.scheduleWatch = null;
        
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
        this.uploadBtn = document.getElementById('upload-btn');
        this.uploadDialog = document.getElementById('upload-dialog');
        this.uploadClose = document.getElementById('upload-close');
        this.clearBtn = document.getElementById('clear-text');
        this.speedControl = document.getElementById('speed-control');
        this.speedDisplay = document.getElementById('speed-display');
        this.mirrorModeCheckbox = document.getElementById('mirror-mode');
        this.hideTimerCheckbox = document.getElementById('hide-timer');
        this.onAirModeCheckbox = document.getElementById('on-air-mode');
        this.fullscreenBtn = document.getElementById('fullscreen-display');
        this.voiceBtn = document.getElementById('voice-track');
        this.settingsBtn = document.getElementById('settings-open');
        this.settingsDialog = document.getElementById('settings-dialog');
        this.settingsForm = document.getElementById('settings-form');
        this.settingsName = document.getElementById('settings-name');
        this.settingsLang = document.getElementById('settings-lang');
        this.settingsUiLang = document.getElementById('settings-ui-lang');
        this.settingsProgress = document.getElementById('settings-progress');
        this.settingsCancel = document.getElementById('settings-cancel');
        this.settingsClose = document.getElementById('settings-close');
        this.previewBox = document.getElementById('live-preview');
        this.previewFrame = document.getElementById('preview-frame');
        // The thumbnail is a display like any other, so it has to join this session
        // and not the one next door: the src is set here, once the id exists.
        this.previewFrame.src = `display.html?preview=1&s=${this.sessionId}`;
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
        this.deviceCountEl = document.getElementById('device-count');
        this.displayUrl = document.getElementById('display-url');
        this.displayUrlBtn = document.getElementById('display-url-btn');
        this.lanUrlRow = document.getElementById('lan-url-row');
        this.lanUrl = document.getElementById('lan-url');
        this.qrDialog = document.getElementById('qr-dialog');
        this.qrCode = document.getElementById('qr-code');
        this.qrUrl = document.getElementById('qr-url');
        this.qrCopyBtn = document.getElementById('qr-copy');
        this.qrCloseBtn = document.getElementById('qr-close');
        this.formatBtn = document.getElementById('format-text');
        this.autoFormatBtn = document.getElementById('auto-format');
        this.formatFlags = { caps: true, sentences: true, paragraphs: true, punctuation: true };
        this.readingLineBtn = document.getElementById('reading-line-btn');
        this.readingLineSettings = document.getElementById('reading-line-settings');
        this.readingLinePanel = document.getElementById('reading-line-panel');
        this.readingStylePicker = document.getElementById('reading-style-picker');
        this.readingLinePosition = document.getElementById('reading-line-position');
        this.readingLineThickness = document.getElementById('reading-line-thickness');
        this.readingArrowSize = document.getElementById('reading-arrow-size');
        this.readingArrowSide = document.getElementById('reading-arrow-side');
        this.readingLineSwatches = document.getElementById('reading-line-swatches');
        this.readingPopupScrim = document.getElementById('reading-popup-scrim');
        this.exportTxtBtn = document.getElementById('export-txt');
        this.fontSizeInput = document.getElementById('display-font-size');
        this.lineHeightInput = document.getElementById('display-line-height');
        this.progressBar = document.getElementById('script-progress');
        this.progressWrap = this.progressBar?.parentElement;
    }
    
    bindEvents() {
        this.fileUpload?.addEventListener('change', (e) => this.handleFileUpload(e));
        this.clearBtn.addEventListener('click', () => this.clearText());
        this.exportTxtBtn.addEventListener('click', () => this.exportScript());
        this.mirrorModeCheckbox.addEventListener('change', (e) => this.updateMirrorMode(e.target.checked));
        this.hideTimerCheckbox.addEventListener('change', (e) => this.updateHideTimer(e.target.checked));
        this.onAirModeCheckbox.addEventListener('change', (e) => this.updateOnAir(e.target.checked));
        this.fullscreenBtn.addEventListener('click', () => this.toggleDisplayFullscreen());
        this.bindSettings();
        this.bindReadingLine();
        this.bindFormatControl();
        this.bindTypeControls();
        this.previewMirrorBtn?.addEventListener('click', () => this.togglePreviewMirror());
        document.querySelector('.display-toggles')?.addEventListener('focusin', () => this.pinShell());
        this.scheduledStartInput.addEventListener('change', () => this.updateScheduledStart());
        this.clearScheduleBtn.addEventListener('click', () => this.clearScheduledStart());
        this.playBtn.addEventListener('click', () => this.togglePlayback());
        this.bindHotkeys();
        this.resetBtn.addEventListener('click', () => this.reset());
        this.bindQr();
        this.formatBtn?.addEventListener('click', () => {
            this.closeFormatPanels();
            this.formatTextForTeleprompter();
        });
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
        this.editorToolbar = new EditorToolbar({
            editor: this.textPreview,
            toolbar: document.getElementById('editor-toolbar'),
            findBar: document.getElementById('editor-find'),
            onChange: () => {
                this.sendTextUpdate();
                this.updateDurationCalculations();
            }
        });
        this.syncTypeInputs();
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
        this.previewBadge.textContent = t(this.isPlaying ? 'preview.scroll' : 'preview.paused');
        this.previewBadge.classList.toggle('is-live', this.isPlaying);
    }

    exportScript() {
        const blob = new Blob([this.textPreview.innerText || ''], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'script.txt';
        link.click();
        URL.revokeObjectURL(url);
    }
    
    connectWebSocket() {
        try {
            this.updateConnectionStatus('connecting', 'status.connecting');
            // Construct WebSocket URL dynamically based on current location
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsPort = window.location.port || (window.location.protocol === 'https:' ? 443 : 80);
            const wsUrl = `${wsProtocol}//${window.location.hostname}:${wsPort}`;
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('Connected to WebSocket server');
                this.updateConnectionStatus('connected', 'status.connected');
                this.reconnectAttempts = 0;
                
                // Register as controller. The server answers with stateSync; whether we
                // adopt the running show or seed it is decided there, not here.
                this.ws.send(JSON.stringify({
                    type: 'register',
                    role: 'controller',
                    session: this.sessionId
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
                this.updateConnectionStatus('disconnected', 'status.disconnected');
                this.scheduleReconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateConnectionStatus('disconnected', 'status.error');
            };
            
        } catch (error) {
            console.error('Failed to connect to WebSocket:', error);
            this.updateConnectionStatus('disconnected', 'status.failed');
            this.scheduleReconnect();
        }
    }
    
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            this.updateConnectionStatus('connecting', 'status.reconnecting', { s: Math.ceil(delay / 1000) });
            
            setTimeout(() => {
                this.connectWebSocket();
            }, delay);
        } else {
            this.updateConnectionStatus('disconnected', 'status.gaveUp');
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
        if (Number.isFinite(state.fontSize)) this.fontSize = state.fontSize;
        if (Number.isFinite(state.lineHeight)) this.lineHeight = state.lineHeight;
        this.syncTypeInputs();
        if (Number.isFinite(state.speed)) {
            this.speed = state.speed;
            this.speedMultiplier = state.speedMultiplier || state.speed / 150;
            this.speedWidget?.setMultiplier(this.speedMultiplier, { silent: true });
        }
        if (state.settings) this.applySettings(state.settings);
        this.mirrorModeCheckbox.checked = !!state.mirrorMode;
        this.hideTimerCheckbox.checked = !state.hideTimer;
        this.onAirModeCheckbox.checked = !!state.onAir;
        if (state.readingLine) this.applyReadingLineControls(state.readingLine);
        this.editorToolbar?.syncBookmarkCount();
        this.updateDurationCalculations();
        this.adoptPlayback(state);
        this.armScheduledStart(state.scheduledStartTime);
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
            localStorage.setItem(scriptCacheKey(this.sessionId), html);
        } catch {
            /* private mode */
        }
    }

    restoreSavedSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(settingsCacheKey(this.sessionId)) || 'null');
            if (saved?.name) this.applySettings(saved);
        } catch {
            /* private mode, or nothing cached yet */
        }
    }

    restoreSavedScript() {
        try {
            const saved = localStorage.getItem(scriptCacheKey(this.sessionId));
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
        this.sendMessage({ type: 'setLineHeight', value: this.lineHeight });
        this.updateDurationCalculations();
        this.sendMessage({ type: 'setMirrorMode', enabled: this.mirrorModeCheckbox.checked });
        this.sendMessage({ type: 'setHideTimer', enabled: !this.hideTimerCheckbox.checked });
        this.sendMessage({ type: 'setOnAir', enabled: this.onAirModeCheckbox.checked });
        this.sendReadingLine();
        
        // Send scheduled start if set
        if (this.scheduledStartInput.value) {
            this.updateScheduledStart();
        }
    }
    
    bindSettings() {
        if (!this.settingsBtn || !this.settingsDialog) return;
        this.settingsBtn.addEventListener('click', () => {
            this.pinShell();
            this.settingsName.value = this.settings.name;
            this.settingsLang.value = this.settings.lang;
            this.settingsUiLang.value = this.settings.uiLang;
            this.settingsProgress.value = this.settings.progressPosition === 'top'
                || this.settings.progressPosition === 'bottom'
                ? this.settings.progressPosition
                : (this.settings.showProgress ? 'bottom' : 'hidden');
            this.settingsDialog.showModal();
        });
        // Both dismiss without saving, like the Escape key the dialog already handles.
        this.settingsCancel.addEventListener('click', () => this.settingsDialog.close());
        this.settingsClose?.addEventListener('click', () => this.settingsDialog.close());
        this.settingsForm.addEventListener('submit', () => {
            const progressPosition = this.settingsProgress.value === 'top'
                || this.settingsProgress.value === 'bottom'
                ? this.settingsProgress.value
                : 'hidden';
            const next = {
                name: this.settingsName.value.trim() || this.settings.name,
                lang: this.settingsLang.value,
                uiLang: this.settingsUiLang.value,
                progressPosition,
                showProgress: progressPosition !== 'hidden'
            };
            this.applySettings(next);
            this.sendMessage({ type: 'setSettings', ...next });
        });
    }

    applySettings({ name, lang, uiLang, showProgress, progressPosition }) {
        const pos = progressPosition === 'top' || progressPosition === 'bottom' || progressPosition === 'hidden'
            ? progressPosition
            : (showProgress ? 'bottom' : 'hidden');
        this.settings = { name, lang, uiLang: resolveUiLang(uiLang), showProgress: pos !== 'hidden', progressPosition: pos };
        applyLanguage(this.settings.uiLang);
        // The recogniser follows the reader, so it takes the script language, never the
        // interface one: a French bulletin read from an English interface is normal.
        this.voiceTracker?.setLanguage(lang);
        this.retranslate();
        // Cached so the header carries the right name from the first paint; the server
        // still owns the value and overwrites this the moment its state arrives.
        try {
            localStorage.setItem(settingsCacheKey(this.sessionId), JSON.stringify(this.settings));
        } catch {
            /* private mode */
        }
        document.querySelector('.controller-header h1').textContent = name;
        document.title = name;
    }

    // Labels rendered from JS are outside the markup the translator walks, so they are
    // re-rendered here whenever the language changes.
    retranslate() {
        this.syncPlayButton();
        this.updatePreviewBadge();
        this.speedWidget?.retranslate?.();
        if (this.lastConnectionInfo) this.updateConnectionInfo(this.lastConnectionInfo);
        else if (this.lastStatus) {
            const { status, key, vars } = this.lastStatus;
            this.updateConnectionStatus(status, key, vars);
        }
        if (this.voiceBtn?.disabled) this.voiceBtn.title = t('playback.voiceUnsupported');
        if (!this.scheduledStartInput?.value && this.scheduleInfo) {
            this.scheduleInfo.innerHTML = `<span>${t('schedule.none')}</span>`;
        }
    }

    handleMessage(data) {
        switch (data.type) {
            case 'settings':
                this.applySettings(data);
                break;

            // The screen setting belongs to the session, not to this window: the toggle
            // follows what the server did rather than what this page assumed it would do.
            case 'setHideTimer':
                if (this.hideTimerCheckbox) this.hideTimerCheckbox.checked = !data.enabled;
                break;

            case 'setOnAir':
                if (this.onAirModeCheckbox) this.onAirModeCheckbox.checked = !!data.enabled;
                break;

            case 'stateSync':
                // The settings belong to the prompter, not to the show, so they apply
                // even when there is no script loaded to adopt.
                if (data.state?.settings) this.applySettings(data.state.settings);
                if (data.state && (data.state.text || data.state.isPlaying || data.state.isPaused)) {
                    this.adoptState(data.state);
                } else {
                    this.sendInitialState();
                }
                break;
                
            case 'start':
                this.applyRemoteStart(data);
                break;

            case 'pause':
                this.applyRemotePause(data);
                break;

            case 'reset':
                this.applyRemoteReset();
                break;

            case 'clearScheduledStart':
                this.disarmScheduledStart(true);
                break;

            case 'pong':
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
        this.readingLineBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = this.readingStylePicker.hidden;
            this.closeReadingPopups();
            if (!open) return;
            this.readingStylePicker.hidden = false;
            this.readingLineBtn.setAttribute('aria-expanded', 'true');
            this.syncReadingScrim();
        });
        this.readingStylePicker?.addEventListener('click', (e) => {
            const choice = e.target.closest('[data-style]');
            if (!choice) return;
            const style = choice.dataset.style === 'arrow' || choice.dataset.style === 'line'
                ? choice.dataset.style
                : 'none';
            this.readingLine.style = style;
            this.readingLine.enabled = style !== 'none';
            if (style !== 'none') this.readingLine.lastStyle = style;
            this.closeReadingPopups();
            this.syncReadingLineControls();
            this.sendReadingLine();
        });
        this.readingLineSettings?.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = this.readingLinePanel.hidden;
            this.closeReadingPopups();
            if (!open) return;
            this.readingLinePanel.hidden = false;
            this.readingLineSettings.setAttribute('aria-expanded', 'true');
            this.syncReadingScrim();
        });
        this.readingPopupScrim?.addEventListener('click', () => this.closeReadingPopups());
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
        this.readingArrowSize?.addEventListener('input', () => {
            this.readingLine.size = Number(this.readingArrowSize.value);
            this.syncReadingLineControls();
            this.sendReadingLine();
        });
        this.readingArrowSide?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-side]');
            if (!btn) return;
            this.readingLine.side = btn.dataset.side;
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
            if (e.target.closest('.display-line-control')) return;
            this.closeReadingPopups();
        });
        document.addEventListener('appLanguageChange', () => this.syncReadingLineControls());
        this.syncReadingLineControls();
    }

    closeReadingPopups() {
        if (this.readingLinePanel) this.readingLinePanel.hidden = true;
        if (this.readingStylePicker) this.readingStylePicker.hidden = true;
        this.readingLineSettings?.setAttribute('aria-expanded', 'false');
        this.readingLineBtn?.setAttribute('aria-expanded', 'false');
        this.syncReadingScrim();
    }

    syncReadingScrim() {
        const open = (this.readingLinePanel && !this.readingLinePanel.hidden)
            || (this.readingStylePicker && !this.readingStylePicker.hidden);
        if (this.readingPopupScrim) this.readingPopupScrim.hidden = !open;
    }

    applyReadingLineControls(line) {
        const style = line.style === 'arrow' || line.style === 'line' || line.style === 'none'
            ? line.style
            : (line.enabled ? 'line' : 'none');
        const lastStyle = line.lastStyle === 'arrow' || line.style === 'arrow' ? 'arrow' : 'line';
        this.readingLine = {
            enabled: !!line.enabled && style !== 'none',
            style,
            lastStyle: style === 'arrow' || style === 'line' ? style : lastStyle,
            position: Math.min(80, Math.max(20, Number(line.position) || 50)),
            color: line.color || '#ffffff',
            thickness: Math.min(8, Math.max(1, Number(line.thickness) || 2)),
            size: Math.min(56, Math.max(16, Number(line.size) || 28)),
            side: line.side === 'right' || line.side === 'both' ? line.side : 'left'
        };
        this.syncReadingLineControls();
    }

    syncReadingLineControls() {
        const { enabled, style, lastStyle, position, color, thickness, size, side } = this.readingLine;
        const shown = style === 'arrow' || style === 'line' ? style : (lastStyle === 'arrow' ? 'arrow' : 'line');
        this.readingLineBtn?.setAttribute('aria-pressed', String(enabled));
        if (this.readingLineBtn) this.readingLineBtn.dataset.guide = shown;
        const label = document.getElementById('reading-guide-label');
        const labelKey = shown === 'arrow' ? 'playback.arrow' : 'playback.line';
        if (label) {
            label.dataset.i18n = labelKey;
            label.textContent = t(labelKey);
        }
        this.readingStylePicker?.querySelectorAll('[data-style]').forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.style === style);
        });
        this.readingLinePanel?.querySelectorAll('[data-guide]').forEach((el) => {
            el.hidden = !el.dataset.guide.split(/\s+/).includes(style);
        });
        if (this.readingLinePosition) this.readingLinePosition.value = String(position);
        if (this.readingLineThickness) this.readingLineThickness.value = String(thickness);
        if (this.readingArrowSize) this.readingArrowSize.value = String(size);
        const posLabel = document.getElementById('reading-line-pos-label');
        const thickLabel = document.getElementById('reading-line-thick-label');
        const sizeLabel = document.getElementById('reading-arrow-size-label');
        if (posLabel) posLabel.textContent = `${position}%`;
        if (thickLabel) thickLabel.textContent = `${thickness}px`;
        if (sizeLabel) sizeLabel.textContent = `${size}px`;
        this.readingArrowSide?.querySelectorAll('[data-side]').forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.side === side);
        });
        this.readingLineSwatches?.querySelectorAll('[data-color]').forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.color === color);
        });
    }

    bindFormatControl() {
        this.uploadBtn?.addEventListener('click', () => {
            this.closeFormatPanels();
            this.uploadDialog?.showModal();
        });
        this.uploadClose?.addEventListener('click', () => this.uploadDialog?.close());
        this.uploadDialog?.addEventListener('click', (e) => {
            if (e.target === this.uploadDialog) this.uploadDialog.close();
        });
        const inputs = document.querySelectorAll('[data-format-flag]');
        inputs.forEach((input) => {
            const key = input.dataset.formatFlag;
            if (!(key in this.formatFlags)) return;
            input.checked = this.formatFlags[key];
            input.addEventListener('change', () => {
                this.formatFlags[key] = input.checked;
                inputs.forEach((other) => {
                    if (other.dataset.formatFlag === key) other.checked = input.checked;
                });
            });
        });
        document.querySelectorAll('.editor-format-settings').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const panel = btn.closest('.editor-format-control')?.querySelector('.editor-format-panel');
                if (!panel) return;
                const open = panel.hidden;
                this.closeFormatPanels(open ? panel : null);
                panel.hidden = !open;
                btn.setAttribute('aria-expanded', String(open));
            });
        });
        document.addEventListener('click', (e) => {
            if (e.target.closest('.editor-format-control')) return;
            this.closeFormatPanels();
        });
    }

    closeFormatPanels(keep) {
        document.querySelectorAll('.editor-format-panel').forEach((panel) => {
            if (panel === keep) return;
            panel.hidden = true;
            panel.closest('.editor-format-control')
                ?.querySelector('.editor-format-settings')
                ?.setAttribute('aria-expanded', 'false');
        });
    }

    sendReadingLine() {
        this.sendMessage({ type: 'setReadingLine', ...this.readingLine });
    }

    updateConnectionInfo(data) {
        this.lastConnectionInfo = data;
        // Update connection status display with count info
        const totalConnections = data.controllers + data.displays;
        // A silently ignored display would be its own kind of confusing: the bar behaves
        // while that window still crawls, so name it here where the operator looks.
        const stale = data.stale ? t('status.stale', { n: data.stale }) : '';
        this.displayCount = data.displays;
        if (this.deviceCountEl) this.deviceCountEl.textContent = String(data.displays);
        this.updateConnectionStatus('connected', 'status.displays', {
            n: data.displays,
            s: data.displays !== 1 ? 's' : '',
            stale
        });
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
                alert(t('upload.legacyDoc'));
                return;
            } else {
                text = await this.readTextFile(file);
            }
            
            this.setPrompterText(text);
            this.uploadDialog?.close();
        } catch (error) {
            alert(t('upload.readError') + error.message);
        } finally {
            event.target.value = '';
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
        if (this.autoFormatBtn?.checked) {
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
                fontSize: `${this.fontSize}px`,
                lineHeight: String(this.lineHeight),
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
    
    bindTypeControls() {
        const commit = (input, apply) => {
            input.addEventListener('change', () => apply(input));
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                apply(input);
                input.blur();
            });
        };
        if (this.fontSizeInput) commit(this.fontSizeInput, (el) => this.updateFontSize(el.value));
        if (this.lineHeightInput) commit(this.lineHeightInput, (el) => this.updateLineHeight(el.value));
    }

    syncTypeInputs() {
        if (this.fontSizeInput) this.fontSizeInput.value = String(this.fontSize);
        if (this.lineHeightInput) this.lineHeightInput.value = this.lineHeight.toFixed(1);
    }

    updateFontSize(value) {
        const n = Math.min(160, Math.max(12, Math.round(Number(value))));
        if (!Number.isFinite(n)) {
            this.syncTypeInputs();
            return;
        }
        this.fontSize = n;
        this.syncTypeInputs();
        this.sendMessage({ type: 'setFontSize', value: this.fontSize });
    }

    updateLineHeight(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) {
            this.syncTypeInputs();
            return;
        }
        this.lineHeight = Math.min(4, Math.max(1, Math.round(n * 10) / 10));
        this.syncTypeInputs();
        this.sendMessage({ type: 'setLineHeight', value: this.lineHeight });
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
    
    updateHideTimer(show) {
        this.pinShell();
        this.sendMessage({ type: 'setHideTimer', enabled: !show });
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
                alert(t('schedule.past'));
                this.scheduledStartInput.value = '';
                return;
            }
            
            this.scheduleInfo.innerHTML = `<span>${t('schedule.set', { when: scheduledDate.toLocaleString() })}</span>`;
            this.armScheduledStart(scheduledDate.getTime());
            this.sendMessage({ 
                type: 'setScheduledStart', 
                scheduledTime: scheduledDate.getTime() 
            });
        } else {
            this.clearScheduledStart();
        }
    }
    
    clearScheduledStart() {
        this.disarmScheduledStart(true);
        this.sendMessage({ type: 'clearScheduledStart' });
    }

    armScheduledStart(timestamp) {
        const at = Number(timestamp);
        if (!Number.isFinite(at) || at <= Date.now()) {
            this.disarmScheduledStart(false);
            return;
        }
        this.scheduledAt = at;
        if (this.scheduledStartInput && !this.scheduledStartInput.value) {
            this.scheduledStartInput.value = this.toLocalDateTimeValue(at);
        }
        this.tickScheduledStart();
    }

    disarmScheduledStart(clearInput) {
        this.scheduledAt = null;
        if (this.scheduleWatch) {
            clearTimeout(this.scheduleWatch);
            this.scheduleWatch = null;
        }
        if (!clearInput) return;
        if (this.scheduledStartInput) this.scheduledStartInput.value = '';
        if (this.scheduleInfo) this.scheduleInfo.innerHTML = `<span>${t('schedule.none')}</span>`;
    }

    tickScheduledStart() {
        if (this.scheduleWatch) {
            clearTimeout(this.scheduleWatch);
            this.scheduleWatch = null;
        }
        if (!this.scheduledAt) return;
        const left = this.scheduledAt - Date.now();
        if (left <= 0) {
            this.onScheduledGo();
            return;
        }
        this.scheduleWatch = setTimeout(() => this.tickScheduledStart(), Math.min(left, 250));
    }

    onScheduledGo() {
        this.disarmScheduledStart(true);
        if (this.isPlaying) {
            this.syncPlayButton();
            return;
        }
        this.start(true);
    }

    toLocalDateTimeValue(ms) {
        const d = new Date(ms);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    applyRemoteStart(data) {
        this.disarmScheduledStart(true);
        this.cancelPreroll();
        this.isPlaying = true;
        this.isPaused = false;
        this.startTime = Number.isFinite(data.startTime) ? data.startTime : Date.now();
        this.pausedTime = Number.isFinite(data.pausedTime) ? data.pausedTime : 0;
        this.syncPlayButton();
        this.startTimer();
    }

    applyRemotePause(data) {
        this.isPlaying = false;
        this.isPaused = true;
        this.pausedTime = Number.isFinite(data.pausedTime) ? data.pausedTime : this.pausedTime;
        this.syncPlayButton();
        this.stopTimer();
        this.updateDisplay();
    }

    applyRemoteReset() {
        this.cancelPreroll();
        this.isPlaying = false;
        this.isPaused = false;
        this.startTime = null;
        this.pausedTime = 0;
        this.displayRatio = 0;
        this.displayRemaining = null;
        this.syncPlayButton();
        this.stopTimer();
        this.updateDisplay();
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
        this.setPlayGlyph('count', String(left));
        if (this.playLabel) this.playLabel.textContent = t('playback.starting');
    }

    syncPlayButton() {
        if (!this.playBtn || this.prerollInterval) return;
        const playing = this.isPlaying;
        const idle = t(this.isAtStart() ? 'playback.start' : 'playback.continue');
        this.playBtn.classList.toggle('start', !playing);
        this.playBtn.classList.toggle('pause', playing);
        this.playBtn.setAttribute('aria-pressed', String(playing));
        this.playBtn.setAttribute('aria-label', playing ? t('playback.pause') : idle);
        this.setPlayGlyph(playing ? 'pause' : 'play');
        if (this.playLabel) this.playLabel.textContent = playing ? t('playback.pause') : idle;
        this.updatePreviewBadge();
    }

    setPlayGlyph(kind, count) {
        if (!this.playIcon) return;
        this.playIcon.dataset.glyph = kind;
        const n = this.playIcon.querySelector('[data-play="count"]');
        if (kind === 'count' && n) n.textContent = count;
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
        
        this.syncPlayButton();
        
        this.sendPlayback('start');
        this.startTimer();
    }
    
    isAtStart() {
        if (this.isAtEnd()) return false;
        if ((this.displayRatio || 0) > 0.015) return false;
        if ((this.pausedTime || 0) > 400) return false;
        return true;
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
        this.syncPlayButton();
        
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
            this.voiceBtn.title = t('playback.voiceUnsupported');
            return;
        }
        this.voiceTracker = new VoiceTracker({
            onPosition: (ratio) => this.applyVoiceRatio(ratio),
            onState: (listening, message) => {
                this.voiceBtn.setAttribute('aria-pressed', String(listening));
                this.voiceBtn.classList.toggle('is-listening', listening);
                if (message) alert(t(message.key, message.vars));
            }
        });
        this.voiceTracker.setScript(this.getEditorPlainText());
        this.voiceTracker.setLanguage(this.settings.lang);
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
        this.syncPlayButton();
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
    
    // Takes a key, not a sentence, and remembers it: the status is live state, so a
    // language change has to redraw whatever it currently says.
    updateConnectionStatus(status, key, vars) {
        this.lastStatus = { status, key, vars };
        const label = t(key, vars);
        this.connectionStatus.className = `device-count ${status}`;
        this.connectionStatus.title = label;
        this.connectionStatus.setAttribute('aria-label', label);
        if (status !== 'connected' && this.deviceCountEl) this.deviceCountEl.textContent = '0';
    }
    
    updateDisplayUrl() {
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = window.location.port ? `:${window.location.port}` : '';
        const displayUrl = `${protocol}//${hostname}${port}/d/${this.sessionId}`;
        this.displayUrl.textContent = displayUrl;
    }
    
    // Prefer a LAN address so a phone can open this controller. Loopback is still shown
    // when that is all we have: hiding the row made the URL vanish on Docker/localhost.
    async updateLanUrl() {
        if (!this.lanUrlRow || !this.lanUrl) return;
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
        if (!host) host = window.location.host;

        this.lanControllerUrl = `${window.location.protocol}//${host}/${this.sessionId}`;
        this.lanUrl.textContent = this.lanControllerUrl;
        if (others.length > 1) this.lanUrl.title = t('header.otherAddresses', { list: others.join(', ') });
        this.lanUrlRow.hidden = false;
    }

    // navigator.clipboard exists only in a secure context, and a studio runs this over
    // plain http on the local network - so on the very machine that needs to hand a URL
    // to a phone, the property is undefined and reading .writeText threw synchronously,
    // before any .catch could see it. The button simply did nothing.
    copyToClipboard(text, button) {
        const done = () => {
            if (!button) return;
            button.textContent = t('header.copied');
            setTimeout(() => {
                button.textContent = t('header.copy');
            }, 2000);
        };

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => this.copyBySelection(text, done));
            return;
        }
        this.copyBySelection(text, done);
    }

    // The old way, and the only way without a secure context.
    copyBySelection(text, done) {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        try {
            document.execCommand('copy');
            done();
        } catch {
            // Nothing left to try: leave the URL selected so it can be copied by hand.
        }
        field.remove();
    }

    bindQr() {
        if (!this.qrDialog) return;
        this.displayUrlBtn?.addEventListener('click', () => this.showQr(this.displayUrl.textContent));
        this.lanUrlRow?.addEventListener('click', () => {
            if (this.lanControllerUrl) this.showQr(this.lanControllerUrl);
        });
        this.qrCloseBtn.addEventListener('click', () => this.qrDialog.close());
        this.qrCopyBtn.addEventListener('click', () => this.copyToClipboard(this.qrUrl.textContent, this.qrCopyBtn));
    }

    // A phone is the fastest way to reach a URL nobody wants to type: point the camera.
    // The encoder is vendored rather than fetched, because the wifi this code is meant to
    // bridge often has no route to the internet.
    showQr(url) {
        if (!url || typeof qrcode !== 'function') return;
        const code = qrcode(0, 'M');
        code.addData(url);
        code.make();
        this.qrCode.innerHTML = code.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
        this.qrUrl.textContent = url;
        this.qrCopyBtn.textContent = t('header.copy');
        this.qrDialog.showModal();
    }

    formatTextForTeleprompter() {
        const currentText = this.getEditorPlainText();
        if (!currentText.trim()) {
            alert(t('upload.noText'));
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
        
        if (this.formatFlags.caps) formattedText = this.convertToUppercase(formattedText);
        if (this.formatFlags.punctuation) formattedText = this.enhancePunctuationPauses(formattedText);
        if (this.formatFlags.sentences) formattedText = this.formatSentenceBreaks(formattedText);
        if (this.formatFlags.paragraphs) formattedText = this.addParagraphBreaks(formattedText);
        
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