const ThemeControl = (() => {
    const KEY = 'teleprompter-theme';

    const preferred = () => {
        const fromQuery = new URLSearchParams(location.search).get('theme');
        if (fromQuery === 'light' || fromQuery === 'dark') return fromQuery;
        try {
            const saved = localStorage.getItem(KEY);
            if (saved === 'light' || saved === 'dark') return saved;
        } catch {
            /* private mode */
        }
        return 'dark'; // a prompter is dark; light is opt-in only
    };

    const syncButtons = (theme) => {
        const dark = theme === 'dark';
        document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(dark));
            // t() only exists where i18n.js is loaded; the display does without it.
            const say = typeof t === 'function' ? t : (key) => key.split('.').pop();
            btn.title = say(dark ? 'theme.toLight' : 'theme.toDark');
            const label = btn.querySelector('[data-theme-label]');
            if (label) label.textContent = say(dark ? 'theme.dark' : 'theme.light');
        });
    };

    const apply = (theme) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
        syncButtons(theme);
    };

    const toggle = () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        try {
            localStorage.setItem(KEY, next);
        } catch {
            /* private mode */
        }
        apply(next);
    };

    apply(preferred());

    const onReady = () => syncButtons(document.documentElement.dataset.theme);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }

    document.addEventListener('click', (e) => {
        if (e.target.closest('[data-theme-toggle]')) toggle();
    });

    // The toggle writes its own label, so it has to redraw it when the language changes.
    document.addEventListener('appLanguageChange', () => {
        syncButtons(document.documentElement.dataset.theme);
    });

    return { apply, toggle };
})();
