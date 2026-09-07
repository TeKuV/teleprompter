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
            btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
            const label = btn.querySelector('[data-theme-label]');
            if (label) label.textContent = dark ? 'Dark' : 'Light';
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

    return { apply, toggle };
})();
