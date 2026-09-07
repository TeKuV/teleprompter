// Voice tracking - the script follows what is actually said instead of the clock alone.
// The Web Speech API hands over the words, they get aligned against the manuscript, and
// the resulting position is what the controller seeks to.

const VOICE_NEEDLE = 5;      // spoken words compared at once
const VOICE_LOOKBEHIND = 6;  // script words the reader may still be on
const VOICE_LOOKAHEAD = 40;  // script words a skipped passage may cover

function normalizeWords(text) {
    return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

// Aligns the last spoken words against a window of the script and returns the script
// index just after them, or null when no window matches well enough to move on.
// Ties keep the earliest match so a phrase said twice does not skip a paragraph.
function matchPosition(scriptWords, spokenWords, fromIndex) {
    const needle = spokenWords.slice(-VOICE_NEEDLE);
    if (needle.length < 2 || !scriptWords.length) return null;

    const start = Math.max(0, (fromIndex || 0) - VOICE_LOOKBEHIND);
    const end = Math.min(scriptWords.length, (fromIndex || 0) + VOICE_LOOKAHEAD);
    let best = null;
    let bestScore = 0;

    for (let i = start; i < end; i++) {
        let score = 0;
        for (let j = 0; j < needle.length; j++) {
            if (scriptWords[i + j] === needle[j]) score++;
        }
        if (score > bestScore) {
            bestScore = score;
            best = i;
        }
    }

    if (best === null || bestScore < 2) return null;

    // The head stops after the last word that really matched. Recognition noise at the
    // end of a phrase would otherwise push the reader past what they have read, and
    // drifting forward is the one direction a prompter must never drift.
    let lastHit = 0;
    for (let j = 0; j < needle.length; j++) {
        if (scriptWords[best + j] === needle[j]) lastHit = j;
    }
    return Math.min(scriptWords.length, best + lastHit + 1);
}

class VoiceTracker {
    static isSupported() {
        return typeof window !== 'undefined'
            && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    constructor({ onPosition, onState }) {
        this.onPosition = onPosition || (() => {});
        this.onState = onState || (() => {});
        this.scriptWords = [];
        this.index = 0;
        this.finalWords = [];
        this.active = false;
        this.recognition = null;
    }

    setScript(text) {
        this.scriptWords = normalizeWords(text);
    }

    // The operator scrubbing or resetting moves the read head; the mic picks up there.
    setRatio(ratio) {
        const safe = Math.min(1, Math.max(0, Number(ratio) || 0));
        this.index = Math.round(safe * this.scriptWords.length);
        this.finalWords = [];
    }

    start() {
        if (this.active || !VoiceTracker.isSupported()) return;
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new Recognition();
        recognition.lang = document.documentElement.lang || navigator.language || 'fr-FR';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => this.handleResult(event);
        recognition.onerror = (event) => {
            // Silence is normal and onend restarts; a refused mic is not recoverable.
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            this.stop(event.error === 'not-allowed'
                ? 'Microphone access refused'
                : `Voice tracking error: ${event.error}`);
        };
        // Recognition stops itself after a pause, so keep it alive while the button is on.
        recognition.onend = () => {
            if (this.active) recognition.start();
        };

        this.recognition = recognition;
        this.active = true;
        this.finalWords = [];
        recognition.start();
        this.onState(true, '');
    }

    stop(message = '') {
        if (!this.active && !this.recognition) return;
        this.active = false;
        try {
            this.recognition?.abort();
        } catch {
            /* already gone */
        }
        this.recognition = null;
        this.onState(false, message);
    }

    handleResult(event) {
        let interim = [];
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const words = normalizeWords(result[0].transcript);
            if (result.isFinal) this.finalWords.push(...words);
            else interim = interim.concat(words);
        }
        // Only the tail is ever compared, so the transcript does not need keeping.
        if (this.finalWords.length > 40) this.finalWords = this.finalWords.slice(-VOICE_NEEDLE);

        const next = matchPosition(this.scriptWords, this.finalWords.concat(interim), this.index);
        if (next === null || next === this.index) return;
        this.index = next;
        // ponytail: words map to scroll linearly, which is what the display already
        // assumes (pixelsPerWord). Per-paragraph anchors only if long scripts drift.
        this.onPosition(this.index / this.scriptWords.length);
    }
}

if (typeof module !== 'undefined') module.exports = { normalizeWords, matchPosition };
