const assert = require('assert');
const { normalizeWords, matchPosition } = require('../public/js/voice-track.js');

const script = normalizeWords(
    'Bonjour et bienvenue dans le journal de vingt heures. ' +
    'Le président a reçu ce matin les représentants du secteur agricole. ' +
    'Nous ouvrons ce journal avec une information de dernière minute. ' +
    'Bonjour et bienvenue dans le studio.'
);

// Punctuation and accents never reach the matcher.
assert.deepStrictEqual(normalizeWords('Élysée, très bien !'), ['elysee', 'tres', 'bien']);

// Reading the opening moves the head just past what was said.
assert.strictEqual(
    matchPosition(script, normalizeWords('bonjour et bienvenue dans le'), 0),
    5
);

// Recognition noise: the head stays where it was.
assert.strictEqual(
    matchPosition(script, normalizeWords('euh pff hmm voila bon'), 5),
    null
);

// A single word is never enough to move.
assert.strictEqual(matchPosition(script, normalizeWords('journal'), 0), null);

// The reader skips a sentence: the head follows, inside the lookahead window.
assert.strictEqual(
    matchPosition(script, normalizeWords('nous ouvrons ce journal avec'), 5),
    script.indexOf('nous') + 5
);

// A phrase said twice resolves to the first occurrence, not the later repeat.
assert.strictEqual(
    matchPosition(script, normalizeWords('bonjour et bienvenue dans le'), 0),
    5
);

// A misheard last word does not carry the head past what was actually read.
assert.strictEqual(
    matchPosition(script, normalizeWords('le president a recu setmatin'), 6),
    script.indexOf('recu') + 1
);

// Noise after a real phrase leaves the head on the last word that was recognised.
assert.strictEqual(
    matchPosition(script, normalizeWords('de vingt heures euh pff'), 5),
    script.indexOf('heures') + 1
);

// The head never runs past the end of the script.
assert.ok(matchPosition(script, script.slice(-3), script.length - 5) <= script.length);

console.log('voice-match: ok');
