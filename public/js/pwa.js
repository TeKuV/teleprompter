// Registered by both controller.html and display.html; scope defaults to sw.js's own
// directory (the site root), so one registration covers both installable surfaces.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
            // Install still works without it (Chrome hasn't required a service worker
            // for a while), so a failed registration - blocked storage, file://, etc. -
            // is quietly skipped rather than surfaced to the operator.
        });
    });
}
