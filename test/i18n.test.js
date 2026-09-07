const assert = require('assert');
const { I18N, t, resolveUiLang, I18nStore } = require('../public/js/i18n.js');

const en = Object.keys(I18N.en);
const fr = Object.keys(I18N.fr);

// A missing translation is invisible until someone reads that screen on air.
assert.deepStrictEqual(en.filter((k) => !fr.includes(k)), [], 'keys missing from fr');
assert.deepStrictEqual(fr.filter((k) => !en.includes(k)), [], 'keys missing from en');

// No empty label: an untranslated string is a nuisance, a blank button is a dead control.
for (const [lang, table] of Object.entries(I18N)) {
    for (const [key, value] of Object.entries(table)) {
        assert.ok(value.trim(), `${lang}.${key} is empty`);
    }
}

// Placeholders have to survive translation, or the value never reaches the screen.
for (const key of en) {
    const slots = (s) => (s.match(/\{[a-z]+\}/gi) || []).sort().join(',');
    assert.strictEqual(slots(I18N.fr[key]), slots(I18N.en[key]), `placeholder mismatch on ${key}`);
}

I18nStore.lang = 'fr';
assert.strictEqual(t('playback.start'), 'Démarrer');
assert.strictEqual(t('status.reconnecting', { s: 3 }), 'Reconnexion dans 3 s...');
assert.strictEqual(t('unknown.key'), 'unknown.key', 'an unknown key falls back to itself');

I18nStore.lang = 'en';
assert.strictEqual(t('playback.start'), 'Start');

assert.strictEqual(resolveUiLang('fr'), 'fr');
assert.strictEqual(resolveUiLang('de'), resolveUiLang(undefined), 'unknown language falls back like none');

console.log(`i18n: ok (${en.length} keys x ${Object.keys(I18N).length} languages)`);
