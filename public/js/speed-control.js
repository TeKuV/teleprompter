const SpeedControl = (() => {
    const BASE_WPM = 150;
    const MIN_WPM = 20;
    const MAX = 5;
    const MIN = MIN_WPM / BASE_WPM;
    const STEP = 0.01;
    const PRIMARY = [0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.4, 1.6];

    const clamp = (value) => {
        const wpm = Math.round(BASE_WPM * (Number(value) || 1));
        return Math.min(MAX, Math.max(MIN, wpm / BASE_WPM));
    };
    const label = (n) => {
        const rounded = Math.round(n * 100) / 100;
        return `${rounded}x`;
    };

    class SpeedControl {
        constructor({ slider, display, primaryRoot, wpmHint, onChange }) {
            this.slider = slider;
            this.display = display;
            this.primaryRoot = primaryRoot;
            this.wpmHint = wpmHint;
            this.onChange = onChange;
            this.multiplier = 1;
            this.render();
            this.bind();
            this.sync();
        }

        get wpm() {
            return Math.round(BASE_WPM * this.multiplier);
        }

        setMultiplier(raw, { silent = false } = {}) {
            const next = clamp(Number(raw) || 1);
            const changed = next !== this.multiplier;
            this.multiplier = next;
            this.sync();
            if (!silent && changed) this.onChange(this.wpm, this.multiplier);
        }

        nudge(delta) {
            this.setMultiplier(this.multiplier + delta);
        }

        render() {
            this.primaryRoot.replaceChildren(...PRIMARY.map((n) => this.presetButton(n)));
            this.slider.min = String(MIN);
            this.slider.max = String(MAX);
            this.slider.step = String(STEP);
        }

        presetButton(value) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'speed-preset';
            btn.dataset.speed = String(value);
            btn.textContent = label(value);
            btn.setAttribute('aria-pressed', 'false');
            btn.title = `${label(value)} · ${t('speed.wpm', { n: Math.round(BASE_WPM * value) })}`;
            return btn;
        }

        bind() {
            this.slider.addEventListener('input', (e) => this.setMultiplier(e.target.value));
            const pick = (e) => {
                const btn = e.target.closest('[data-speed]');
                if (btn) this.setMultiplier(btn.dataset.speed);
            };
            this.primaryRoot.addEventListener('click', pick);
        }

        // Re-rendered on a language change: the preset tooltips and the wpm hint are
        // written from here, so the translator walking the markup never sees them.
        render() {
            this.primaryRoot.querySelectorAll('[data-speed]').forEach((btn) => {
                const value = Number(btn.dataset.speed);
                btn.title = `${label(value)} · ${t('speed.wpm', { n: Math.round(BASE_WPM * value) })}`;
            });
            this.sync();
        }

        sync() {
            this.slider.value = String(this.multiplier);
            this.display.textContent = label(this.multiplier);
            if (this.wpmHint) this.wpmHint.textContent = t('speed.wpm', { n: this.wpm });
            this.syncActive();
        }

        syncActive() {
            const buttons = [...this.primaryRoot.querySelectorAll('[data-speed]')];
            for (const btn of buttons) {
                const active = Math.abs(Number(btn.dataset.speed) - this.multiplier) < 0.05;
                btn.classList.toggle('is-active', active);
                btn.setAttribute('aria-pressed', String(active));
            }
        }
    }

    SpeedControl.BASE_WPM = BASE_WPM;
    SpeedControl.MIN = MIN;
    SpeedControl.MAX = MAX;
    SpeedControl.STEP = STEP;
    return SpeedControl;
})();
