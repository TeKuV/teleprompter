class TeleprompterDisplay {
    constructor() {
        this.ws = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.currentPosition = 0;
        this.scrollAnchorAt = 0;
        this.scrollAnchorPosition = 0;
        this.startTime = null;
        this.pausedTime = 0;
        this.segmentDuration = 10 * 60 * 1000;
        this.speed = 150;
        this.speedMultiplier = 1;
        this.fontSize = 48;
        this.readingLinePos = 50;
        this.pxPerWord = null;
        this.timerInterval = null;
        this.scheduledStartTime = null;
        this.scheduledCountdownInterval = null;
        this.prerollInterval = null;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.synced = false;
        this.heartbeatInterval = null;
        this.lastPong = 0;
        this.offline = false;
        this.isPreview = new URLSearchParams(location.search).get('preview') === '1';
        
        this.initializeElements();
        this.applySpeed(this.speed, this.speedMultiplier);
        this.restoreSession();
        this.connectWebSocket();
        if (this.isPreview) document.body.classList.add('preview');
        if (!this.isPreview) this.bindKeyboardShortcuts();
        
        window.addEventListener('resize', () => this.invalidateMetrics());
        window.addEventListener('pagehide', () => this.persistSession());

        // Auto-reconnect on connection loss
        this.setupReconnection();
    }
    
    initializeElements() {
        this.prompterText = document.getElementById('prompter-text');
        this.countdownTimer = document.getElementById('countdown-timer');
        this.elapsedTime = document.getElementById('elapsed-time');
        this.speedHud = document.getElementById('speed-hud');
        this.connectionStatus = document.getElementById('connection-status');
        this.statusIndicator = this.connectionStatus.querySelector('.status-indicator');
        this.statusText = this.connectionStatus.querySelector('.status-text');
        this.onAirIndicator = document.getElementById('on-air-indicator');
        this.scheduledCountdown = document.getElementById('scheduled-countdown');
        this.countdownTime = document.getElementById('countdown-time');
        this.countdownTarget = document.getElementById('countdown-target');
        this.fullscreenHint = document.getElementById('fullscreen-hint');
        this.readingLine = document.getElementById('reading-line');
        this.preroll = document.getElementById('preroll');
        this.nextCue = document.getElementById('next-cue');
        this.nextCueIn = document.getElementById('next-cue-in');
        this.nextCueLabel = document.getElementById('next-cue-label');
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
                this.offline = false;
                this.updateConnectionStatus('connected', 'Connected');
                this.reconnectAttempts = 0;
                
                // Register as display
                this.ws.send(JSON.stringify({
                    type: 'register',
                    role: 'display',
                    preview: this.isPreview
                }));
                this.sendFullscreenState();
                this.startHeartbeat();
            };
            
            this.ws.onmessage = (event) => {
                this.lastPong = Date.now();
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            };
            
            this.ws.onclose = () => {
                this.stopHeartbeat();
                this.offline = true;
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
    
    // A prompter must come back on its own: a server restart mid-show used to exhaust
    // five attempts in half a minute and leave the screen dead until someone reloaded it.
    scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = Math.min(10000, this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1));
        const wait = Math.ceil(delay / 1000);
        this.updateConnectionStatus(
            'connecting',
            this.isPlaying
                ? `Autonomous — reconnecting in ${wait}s…`
                : `Reconnecting in ${wait}s...`
        );
        setTimeout(() => this.connectWebSocket(), delay);
    }

    // A socket the server has already dropped still reads as OPEN here, so the display
    // keeps rendering a dead session while claiming to be connected. Only an answer that
    // never comes reveals it.
    startHeartbeat() {
        this.stopHeartbeat();
        this.lastPong = Date.now();
        this.heartbeatInterval = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            if (Date.now() - this.lastPong > 15000) {
                this.ws.close();
                return;
            }
            this.ws.send(JSON.stringify({ type: 'ping' }));
        }, 5000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    setupReconnection() {
        // Try to reconnect when the page becomes visible again
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) return;
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.reconnectAttempts = 0;
                this.connectWebSocket();
                return;
            }
            // Looks open, but it may have died while the window was away: probe it now
            // instead of waiting out the heartbeat.
            this.ws.send(JSON.stringify({ type: 'ping' }));
        });
    }
    
    handleMessage(data) {
        switch (data.type) {
            case 'stateSync':
                this.syncState(data.state);
                break;
                
            case 'setText':
                this.setPrompterText(data.content, data.styles);
                break;
                
            case 'setSpeed':
                this.applySpeed(data.value, data.multiplier);
                break;
                
            case 'setFontSize':
                this.applyFontSize(data.value);
                break;
                
            case 'setSegmentLength':
                this.applySegmentDuration((data.totalSeconds ?? data.value) * 1000);
                break;
                
            case 'setMirrorMode':
                this.setMirrorMode(data.enabled);
                break;

            case 'setReadingLine':
                this.setReadingLine(data);
                break;
                
            case 'setHideTimer':
                this.setHideTimer(data.enabled);
                break;
                
            case 'positionSync':
                this.reconcilePosition(data);
                break;
                
            case 'setFullscreen':
                this.setFullscreen(data.enabled);
                break;
                
            case 'setOnAir':
                this.setOnAir(data.enabled);
                break;
                
            case 'setScheduledStart':
                this.setScheduledStart(data.scheduledTime);
                break;
                
            case 'clearScheduledStart':
                this.clearScheduledStart();
                break;
                
            case 'preroll':
                this.showPreroll(data.seconds);
                break;

            case 'start':
                this.showPreroll(0);
                this.start(data.startTime, data.pausedTime, data.segmentDuration);
                break;
                
            case 'pause':
                this.pause(data.pausedTime, data.segmentDuration);
                break;
                
            case 'reset':
                this.showPreroll(0);
                this.reset();
                break;

            case 'seek':
                this.seek(data);
                break;
                
            case 'pong':
                // Heartbeat response
                break;
                
            default:
                console.log('Unknown message type:', data.type);
        }
    }
    
    syncState(state) {
        console.log('Syncing state:', state);
        
        if (state.text) {
            this.setPrompterText(state.text, state.textStyles);
        }
        
        this.applySpeed(state.speed, state.speedMultiplier);
        this.applyFontSize(state.fontSize);
        if (Number.isFinite(state.segmentLength)) {
            this.segmentDuration = Math.max(1000, state.segmentLength * 1000);
        }
        
        if (!this.isPreview) this.setMirrorMode(state.mirrorMode);
        if (state.readingLine) this.setReadingLine(state.readingLine);
        this.setHideTimer(state.hideTimer);
        this.setOnAir(state.onAir);
        
        if (state.scheduledStartTime) {
            this.setScheduledStart(state.scheduledStartTime);
        } else {
            this.clearScheduledStart();
        }
        
        const ratio = Number(state.progressRatio);
        const parked = Number.isFinite(ratio) && ratio > 0;
        const local = this.progressRatio();
        const keepLocal = (this.isPlaying || this.isPaused) && local > ratio + 0.002;
        if (state.isPlaying) {
            this.isPlaying = true;
            this.isPaused = false;
            this.startTime = state.startTime || Date.now();
            this.pausedTime = state.pausedTime || 0;
            if (parked && !keepLocal) this.applyProgressRatio(ratio);
            this.startScrolling();
            this.startTimer();
        } else if (state.isPaused) {
            this.pause(state.pausedTime, this.segmentDuration);
            if (parked && !keepLocal) this.applyProgressRatio(ratio);
        } else if (!this.offline || !this.isPlaying) {
            this.reset();
        }
        this.synced = true;
        this.updateDisplay();
    }
    
    setPrompterText(content, styles) {
        if (typeof content !== 'string') return;
        const ratio = this.progressRatio();
        this.invalidateMetrics();
        const trimmed = content.trim();
        if (/<[a-z][\s\S]*>/i.test(trimmed)) {
            this.prompterText.innerHTML = trimmed;
        } else {
            const paragraphs = trimmed.split(/\n\s*\n/).filter((p) => p.trim());
            this.prompterText.innerHTML = paragraphs.map((p) => `<p>${this.escapeHtml(p.trim())}</p>`).join('');
        }
        this.applyTextStyles(styles);
        if (ratio > 0) this.applyProgressRatio(ratio);
        this.updateDisplay();
    }

    applyTextStyles(styles) {
        if (!styles) return;
        if (styles.textAlign) this.prompterText.style.textAlign = styles.textAlign;
        if (styles.fontWeight) this.prompterText.style.fontWeight = styles.fontWeight;
        if (styles.fontStyle) this.prompterText.style.fontStyle = styles.fontStyle;
        if (styles.fontSize) this.applyFontSize(parseFloat(styles.fontSize));
    }

    escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
    
    setMirrorMode(enabled) {
        if (this.isPreview) return;
        document.body.classList.toggle('mirror-mode', !!enabled);
    }

    setReadingLine({ enabled, position, color, thickness } = {}) {
        this.readingLinePos = Math.min(80, Math.max(20, Number(position) || 50));
        if (!this.readingLine) return;
        this.readingLine.hidden = !enabled;
        this.readingLine.style.setProperty('--reading-line-pos', `${this.readingLinePos}%`);
        this.readingLine.style.setProperty('--reading-line-color', color || '#ffffff');
        this.readingLine.style.setProperty('--reading-line-thickness', `${Math.min(8, Math.max(1, Number(thickness) || 2))}px`);
    }
    
    setHideTimer(enabled) {
        const timerDisplay = document.querySelector('.timer-display');
        if (enabled) {
            timerDisplay.style.display = 'none';
        } else {
            timerDisplay.style.display = 'flex';
        }
    }
    
    setOnAir(enabled) {
        if (enabled) {
            this.onAirIndicator.classList.add('active');
        } else {
            this.onAirIndicator.classList.remove('active');
        }
    }
    
    setScheduledStart(scheduledTime) {
        this.scheduledStartTime = scheduledTime;
        const targetDate = new Date(scheduledTime);
        this.countdownTarget.textContent = `Starting at: ${targetDate.toLocaleTimeString()}`;
        
        this.scheduledCountdown.classList.add('active');
        this.startScheduledCountdown();
    }
    
    clearScheduledStart() {
        this.scheduledStartTime = null;
        this.scheduledCountdown.classList.remove('active');
        this.stopScheduledCountdown();
    }
    
    startScheduledCountdown() {
        this.stopScheduledCountdown(); // Clear any existing interval
        
        this.scheduledCountdownInterval = setInterval(() => {
            const now = Date.now();
            const timeRemaining = this.scheduledStartTime - now;
            
            if (timeRemaining <= 0) {
                // Time's up - start the prompter automatically
                this.clearScheduledStart();
                this.autoStart();
                return;
            }
            
            // Update countdown display
            const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
            const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
            
            this.countdownTime.textContent = 
                `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }, 1000);
    }
    
    stopScheduledCountdown() {
        if (this.scheduledCountdownInterval) {
            clearInterval(this.scheduledCountdownInterval);
            this.scheduledCountdownInterval = null;
        }
    }
    
    autoStart() {
        // Simulate receiving a start message from the server
        this.start(Date.now(), 0);
    }
    
    applySegmentDuration(ms) {
        if (!Number.isFinite(ms)) return;
        this.segmentDuration = Math.max(1000, ms);
        this.updateDisplay();
    }

    start(startTime, pausedTime, segmentDuration) {
        this.isPlaying = true;
        this.isPaused = false;
        this.startTime = startTime || Date.now();
        this.pausedTime = pausedTime || 0;
        if (Number.isFinite(segmentDuration)) {
            this.segmentDuration = Math.max(1000, segmentDuration);
        }
        this.startScrolling();
        this.startTimer();
    }
    
    pause(pausedTime, segmentDuration) {
        // Read the clock before dropping out of play, or the freeze lands on whatever the
        // last timer tick saw - up to 200ms of script behind where the reader stopped.
        this.advancePosition();
        this.isPlaying = false;
        this.isPaused = true;
        this.pausedTime = pausedTime || 0;
        if (Number.isFinite(segmentDuration)) {
            this.segmentDuration = Math.max(1000, segmentDuration);
        }
        this.stopScrolling();
        this.stopTimer();
        this.updateDisplay();
    }
    
    reset() {
        this.isPlaying = false;
        this.isPaused = false;
        this.currentPosition = 0;
        this.anchorScroll();
        this.startTime = null;
        this.pausedTime = 0;
        
        this.stopScrolling();
        this.stopTimer();
        
        // Reset text position to starting position (below screen)
        this.prompterText.style.transition = 'none';
        this.prompterText.style.transform = 'translateY(0)';
        this.clearSession();
        this.updateDisplay();
    }
    
    applySpeed(wpm, multiplier) {
        this.advancePosition();
        this.anchorScroll();
        this.speed = Number(wpm) || 150;
        this.speedMultiplier = Number(multiplier) || this.speed / 150;
        if (this.speedHud) this.speedHud.textContent = `${this.speedMultiplier.toFixed(1)}x`;
        if (this.isPlaying) this.runScroll();
        this.updateDisplay();
    }

    applyFontSize(value) {
        this.fontSize = Number(value) || this.fontSize;
        this.prompterText.style.fontSize = this.fontSize + 'px';
        this.invalidateMetrics();
        this.updateDisplay();
    }

    invalidateMetrics() {
        this.advancePosition();
        this.pxPerWord = null;
        this.anchorScroll();
        if (this.isPlaying) this.runScroll();
    }

    // How far the script travels while one word is read, measured from what is actually
    // laid out. Scrolling at (wpm / 60) * this makes the reading speed real: the script
    // takes wordCount / wpm minutes whatever the font size, width or line breaks.
    pixelsPerWord() {
        if (this.pxPerWord) return this.pxPerWord;
        const words = (this.prompterText.textContent.match(/\S+/g) || []).length;
        const height = this.prompterText.scrollHeight;
        const lineHeight = parseFloat(getComputedStyle(this.prompterText).lineHeight)
            || this.fontSize * 1.5;
        this.pxPerWord = words && height ? height / words : lineHeight;
        return this.pxPerWord;
    }

    // Where the scroll is measured from. Anything that moves the script or changes how
    // fast it travels has to reset it, or the time since the last anchor gets replayed at
    // the new rate and the text jumps.
    anchorScroll() {
        this.scrollAnchorAt = performance.now();
        this.scrollAnchorPosition = this.currentPosition;
    }

    // Where the script is now, read off the clock. The number the rest of the display
    // works from - countdown, progress, what gets reported - is never a sum of frames, so
    // a stalled or throttled client loses smoothness, never position.
    advancePosition(now = performance.now()) {
        if (!this.isPlaying) return;
        const pxPerSecond = (this.speed / 60) * this.pixelsPerWord();
        const travelled = this.scrollAnchorPosition
            + pxPerSecond * Math.max(0, now - this.scrollAnchorAt) / 1000;
        this.currentPosition = Math.min(travelled, this.travelEnd());
    }

    // The motion itself belongs to the compositor: one transition to the end of the
    // script, interpolated off the main thread. Writing the transform per frame from JS
    // cannot stay smooth on a machine that is also laying out a 1280x720 preview, driving
    // a second display and feeding a screen recorder - at around 20 repaints a second the
    // text sits still for a frame then catches up two pixels, and that is the judder.
    runScroll() {
        const el = this.prompterText;
        const end = this.travelEnd();
        const pxPerSecond = (this.speed / 60) * this.pixelsPerWord();
        const seconds = pxPerSecond > 0
            ? Math.max(0, (end - this.currentPosition) / pxPerSecond)
            : 0;

        el.style.transition = 'none';
        el.style.transform = `translateY(${-this.currentPosition}px)`;
        void el.offsetWidth; // commit the start, or the transition has nothing to run from
        el.style.transition = `transform ${seconds}s linear`;
        el.style.transform = `translateY(${-end}px)`;
    }

    startScrolling() {
        this.anchorScroll();
        this.runScroll();
    }

    // Freezing has to write the clock's position back, or the text would snap to wherever
    // the interrupted transition had reached.
    stopScrolling() {
        this.prompterText.style.transition = 'none';
        this.prompterText.style.transform = `translateY(${-this.currentPosition}px)`;
    }
    
    // Counts itself down rather than waiting on a message per digit: one lost packet
    // would otherwise leave a number frozen on air. Zero seconds clears it.
    showPreroll(seconds) {
        if (this.prerollInterval) {
            clearInterval(this.prerollInterval);
            this.prerollInterval = null;
        }
        if (!this.preroll) return;

        let left = Math.round(Number(seconds) || 0);
        if (left <= 0) {
            this.preroll.hidden = true;
            return;
        }

        const beat = () => {
            this.preroll.textContent = String(left);
            this.preroll.hidden = false;
            this.preroll.classList.remove('is-beat');
            void this.preroll.offsetWidth;
            this.preroll.classList.add('is-beat');
        };
        beat();
        this.prerollInterval = setInterval(() => {
            left -= 1;
            if (left <= 0) {
                clearInterval(this.prerollInterval);
                this.prerollInterval = null;
                this.preroll.hidden = true;
                return;
            }
            beat();
        }, 1000);
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
    
    // Pixels the script still has to travel before its last line reaches the reading
    // line mid-screen. #prompter-text starts at top: 80% of the text area (display.css).
    travelEnd() {
        const area = this.prompterText.parentElement;
        if (!area) return 0;
        const paddingBottom = parseFloat(getComputedStyle(this.prompterText).paddingBottom) || 0;
        const lineFrac = this.readingLinePos / 100;
        return Math.max(0, this.prompterText.scrollHeight - paddingBottom + (0.8 - lineFrac) * area.clientHeight);
    }

    remainingTravel() {
        return Math.max(0, this.travelEnd() - this.currentPosition);
    }

    progressRatio() {
        const end = this.travelEnd();
        return end > 0 ? Math.min(1, Math.max(0, this.currentPosition / end)) : 0;
    }

    // How far into the script this client is reading, in words. Clients disagree about
    // what a ratio means - it is a fraction of the travel, and the travel carries a
    // screen-height tail that is not proportional to the text - so a wall display and the
    // 1280x720 preview map the same spoken word to ratios a few percent apart. Words are
    // the one currency every client measures identically, so the sync speaks in words.
    scrollWords() {
        const pxPerWord = this.pixelsPerWord();
        return pxPerWord > 0 ? this.currentPosition / pxPerWord : 0;
    }

    // Frames get dropped - a hidden window, a throttled iframe, a stalled machine - and a
    // client that loses them falls behind for good. The reported position is at most a
    // network hop old, so anything beyond a second and a half of reading is real drift.
    reconcilePosition(data) {
        if (!this.synced || !this.prompterText.scrollHeight) return;
        const pxPerWord = this.pixelsPerWord();
        const target = Number.isFinite(data.words)
            ? data.words * pxPerWord
            : Number.isFinite(data.ratio) ? this.travelEnd() * data.ratio : null;
        if (target === null) return;

        // A reconcile is there to let a client that lost frames catch up. On air the
        // script must never walk backwards on its own - an operator going back sends a
        // seek - so a report from behind means the reporter is starved or stale, and
        // following it would drag every other display back with it, mid-sentence.
        if (this.isPlaying && target < this.currentPosition) return;

        const pxPerSecond = (this.speed / 60) * pxPerWord;
        const driftSeconds = pxPerSecond > 0
            ? Math.abs(this.currentPosition - target) / pxPerSecond
            : 0;
        if (driftSeconds < 1.5) return;

        this.currentPosition = target;
        this.anchorScroll();
        if (this.isPlaying) this.runScroll();
        else this.stopScrolling();
        this.updateDisplay();
    }

    // travelEnd() is 0 until the script has been laid out, so retry on the next frame.
    applyProgressRatio(ratio) {
        const safe = Math.min(1, Math.max(0, Number(ratio) || 0));
        const apply = () => {
            this.currentPosition = this.travelEnd() * safe;
            this.anchorScroll();
            if (this.isPlaying) this.runScroll();
            else this.stopScrolling();
        };
        apply();
        if (!this.travelEnd()) requestAnimationFrame(apply);
    }

    seek(data) {
        this.applyProgressRatio(data.ratio);

        this.pausedTime = Number.isFinite(data.pausedTime) ? data.pausedTime : this.pausedTime;
        if (Number.isFinite(data.segmentDuration)) {
            this.segmentDuration = Math.max(1000, data.segmentDuration);
        }
        if (data.playing) {
            this.startTime = data.startTime || Date.now() - this.pausedTime;
            if (!this.isPlaying) this.start(this.startTime, this.pausedTime, this.segmentDuration);
        } else {
            this.startTime = this.pausedTime ? Date.now() - this.pausedTime : this.startTime;
            this.updateDisplay();
        }
    }

    // The countdown tracks the text, not a wall clock: it reads 00:00 exactly when the
    // last line arrives, whatever the speed did on the way and however the frames ran.
    remainingMs() {
        const pxPerSecond = (this.speed / 60) * this.pixelsPerWord();
        return pxPerSecond > 0 ? (this.remainingTravel() / pxPerSecond) * 1000 : 0;
    }

    updateDisplay() {
        this.advancePosition();
        const elapsed = this.startTime ? Date.now() - this.startTime : this.pausedTime;
        
        this.updateCountdownDisplay(this.remainingMs());
        this.updateElapsedDisplay(elapsed);
        this.updateNextCue();
        this.persistSession();
        this.sendProgress();
    }

    persistSession() {
        if (this.isPreview) return;
        try {
            sessionStorage.setItem('teleprompter-display', JSON.stringify({
                ratio: this.progressRatio(),
                speed: this.speed,
                multiplier: this.speedMultiplier,
                playing: this.isPlaying,
                paused: this.isPaused,
                pausedTime: this.pausedTime,
                startTime: this.startTime
            }));
        } catch { /* private mode */ }
    }

    clearSession() {
        try { sessionStorage.removeItem('teleprompter-display'); } catch { /* private mode */ }
    }

    restoreSession() {
        if (this.isPreview) return;
        try {
            const saved = JSON.parse(sessionStorage.getItem('teleprompter-display') || 'null');
            if (!saved) return;
            if (saved.speed) this.applySpeed(saved.speed, saved.multiplier);
            const resume = () => {
                if (this.synced) return;
                if (saved.ratio > 0) this.applyProgressRatio(saved.ratio);
                if (saved.playing) {
                    this.start(saved.startTime || Date.now(), saved.pausedTime || 0);
                } else if (saved.paused) {
                    this.pause(saved.pausedTime || 0);
                    this.applyProgressRatio(saved.ratio);
                }
            };
            requestAnimationFrame(resume);
        } catch { /* ignore */ }
    }

    cueTarget(mark) {
        const area = this.prompterText.parentElement;
        if (!area) return 0;
        return mark.offsetTop + (0.8 - this.readingLinePos / 100) * area.clientHeight;
    }

    cueLabel(mark) {
        if (mark.dataset.label) return mark.dataset.label;
        let node = mark.nextSibling;
        let text = '';
        while (node && text.length < 42) {
            text += node.textContent || '';
            node = node.nextSibling;
        }
        return text.replace(/\s+/g, ' ').trim() || mark.textContent.trim();
    }

    updateNextCue() {
        if (!this.nextCue || this.isPreview) return;
        const marks = [...this.prompterText.querySelectorAll('.script-bookmark')];
        const next = marks.find((mark) => this.cueTarget(mark) > this.currentPosition + 8);
        if (!next) {
            this.nextCue.hidden = true;
            return;
        }
        const pxPerSecond = (this.speed / 60) * this.pixelsPerWord();
        const eta = pxPerSecond > 0 ? (this.cueTarget(next) - this.currentPosition) / pxPerSecond : 0;
        const sec = Math.max(1, Math.round(eta));
        this.nextCue.hidden = false;
        this.nextCueIn.textContent = `in ${sec}s:`;
        this.nextCueLabel.textContent = this.cueLabel(next);
    }

    // The controller has no scroll position of its own, so hand it ours.
    sendProgress() {
        // Until this display has taken the show state it still sits at position zero, and
        // reporting that would overwrite the real one on the server.
        if (this.isPreview || !this.synced) return;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'progress',
                remainingMs: this.remainingMs(),
                ratio: this.progressRatio(),
                words: this.scrollWords()
            }));
        }
    }
    
    updateCountdownDisplay(remaining = this.remainingMs()) {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        
        this.countdownTimer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        // Update timer color based on remaining time
        this.countdownTimer.className = '';
        if (remaining < 60000) {
            this.countdownTimer.classList.add('danger');
        } else if (remaining < 300000) {
            this.countdownTimer.classList.add('warning');
        }
    }
    
    updateElapsedDisplay(elapsed) {
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        
        this.elapsedTime.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    updateConnectionStatus(status, text) {
        this.statusIndicator.className = `status-indicator ${status}`;
        this.statusText.textContent = text;
    }
    
    bindKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // F11 or F for fullscreen
            if (e.key === 'F11' || e.key === 'f' || e.key === 'F') {
                e.preventDefault();
                this.toggleFullscreen();
            }
            
            // Escape to exit fullscreen
            if (e.key === 'Escape') {
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                }
            }
        });
        
        // Handle fullscreen change
        document.addEventListener('fullscreenchange', () => {
            if (document.fullscreenElement) {
                document.body.classList.add('fullscreen');
            } else {
                document.body.classList.remove('fullscreen');
            }
            this.sendFullscreenState();
        });
    }
    
    // Browsers only grant fullscreen on a user gesture, so a request coming over the
    // socket can be refused; when it is, arm the next key or click on the display.
    setFullscreen(enabled) {
        if (this.isPreview) return;
        if (!enabled) {
            this.showFullscreenHint(false);
            if (document.fullscreenElement) document.exitFullscreen();
            return;
        }
        if (document.fullscreenElement) return;
        document.documentElement.requestFullscreen()
            .then(() => this.showFullscreenHint(false))
            .catch(() => this.armFullscreenGesture());
    }

    armFullscreenGesture() {
        this.showFullscreenHint(true);
        if (this.fullscreenArmed) return;
        this.fullscreenArmed = true;
        const go = () => {
            document.removeEventListener('pointerdown', go);
            document.removeEventListener('keydown', go);
            this.fullscreenArmed = false;
            this.showFullscreenHint(false);
            document.documentElement.requestFullscreen().catch(() => {});
        };
        document.addEventListener('pointerdown', go);
        document.addEventListener('keydown', go);
    }

    showFullscreenHint(show) {
        if (this.fullscreenHint) this.fullscreenHint.classList.toggle('active', show);
    }

    sendFullscreenState() {
        if (this.isPreview) return;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'fullscreenState',
                enabled: !!document.fullscreenElement
            }));
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error('Error attempting to enable fullscreen:', err);
            });
        } else {
            document.exitFullscreen();
        }
    }
}

// Initialize display when page loads
document.addEventListener('DOMContentLoaded', () => {
    new TeleprompterDisplay();
});