// Interface translation. Two languages, one flat dictionary, no dependency: the whole
// need is a few dozen labels, and a library would weigh more than the strings it holds.
// This is the language of the chrome around the script. What the reader says is the
// script language, a separate setting - a French bulletin is often run from an English
// interface, and the voice recogniser must follow the reader, not the operator.

const I18N = {
    en: {
        'status.connecting': 'Connecting...',
        'status.connected': 'Connected',
        'status.disconnected': 'Disconnected',
        'status.error': 'Connection Error',
        'status.failed': 'Failed to Connect',
        'status.reconnecting': 'Reconnecting in {s}s...',
        'status.gaveUp': 'Max reconnect attempts reached',
        'status.autonomous': 'Autonomous - reconnecting in {s}s',
        'status.displays': 'Connected ({n} display{s}{stale})',
        'status.stale': ', {n} outdated - reload',

        'header.displayUrl': 'Display URL:',
        'header.openDisplay': 'Open display.html',
        'header.controllerRemote': 'Controller remote:',
        'header.copy': 'Copy',
        'header.copied': 'Copied!',
        'header.otherAddresses': 'This machine is also on: {list}',
        'qr.title': 'Scan to open',

        'theme.dark': 'Dark',
        'theme.light': 'Light',
        'theme.toLight': 'Switch to light mode',
        'theme.toDark': 'Switch to dark mode',
        'theme.toggle': 'Toggle light and dark mode',

        'preview.title': 'Live Preview',
        'preview.mirror': 'Mirror',
        'preview.mirrorTitle': 'Mirror preview',
        'preview.frameTitle': 'Display preview',
        'preview.paused': 'PAUSED',
        'preview.scroll': 'SCROLL',

        'upload.label': 'Upload Manuscript:',
        'upload.format': 'Format Upload',
        'upload.formatTitle': 'Formatting options',
        'upload.auto': 'Auto-format on upload',
        'upload.caps': 'Convert to UPPERCASE',
        'upload.sentences': 'One sentence per line',
        'upload.paragraphs': 'Add paragraph breaks',
        'upload.punctuation': 'Enhance punctuation pauses',
        'upload.clear': 'Clear',
        'upload.formatBtn': 'Format for Teleprompter',
        'upload.noText': 'No text to format. Please upload a manuscript or enter text first.',
        'upload.legacyDoc': 'Legacy .doc files are not supported. Please use .docx format or convert to text.',
        'upload.readError': 'Error reading file: ',

        'speed.label': 'Reading speed',
        'speed.wpm': '{n} wpm',
        'speed.words': 'Words',
        'speed.duration': 'Duration',

        'schedule.label': 'Scheduled Start Time:',
        'schedule.clear': 'Clear',
        'schedule.none': 'No scheduled start time set',
        'schedule.set': 'Scheduled for: {when}',
        'schedule.past': 'Scheduled time must be in the future',

        'editor.title': 'Script editor',
        'editor.exportTxt': 'Export TXT',
        'editor.exportHtml': 'Export HTML',

        'playback.start': 'Start',
        'playback.pause': 'Pause',
        'playback.continue': 'Continue',
        'playback.starting': 'Starting',
        'playback.reset': 'Reset',
        'playback.progress': 'Script progress',
        'playback.options': 'Display options',
        'playback.mirror': 'Mirror',
        'playback.mirrorTitle': 'Mirror Mode',
        'playback.timer': 'Timer',
        'playback.timerTitle': 'Show countdown timer',
        'playback.onAir': 'On air',
        'playback.onAirTitle': 'On Air Indicator',
        'playback.line': 'Line',
        'playback.lineTitle': 'Reading line',
        'playback.lineSettings': 'Reading line settings',
        'playback.position': 'Position',
        'playback.thickness': 'Thickness',
        'playback.color': 'Color',
        'playback.white': 'White',
        'playback.red': 'Red',
        'playback.green': 'Green',
        'playback.yellow': 'Yellow',
        'playback.voice': 'Voice',
        'playback.voiceTitle': 'Voice tracking: the script follows what you say',
        'playback.voiceUnsupported': 'Voice tracking needs Chrome or Edge',
        'playback.micRefused': 'Microphone access refused',
        'playback.voiceError': 'Voice tracking error: {error}',
        'playback.fullscreen': 'Fullscreen',
        'playback.fullscreenTitle': 'Fullscreen on the display',
        'playback.settings': 'Settings',
        'playback.remaining': 'Remaining:',
        'playback.elapsed': 'Elapsed:',
        'playback.hotkeys': 'Space play/pause · ↑↓ speed · ←→ seek · R reset',

        'settings.title': 'Prompter settings',
        'settings.close': 'Close',
        'settings.closeLabel': 'Close settings',
        'settings.name': 'Prompter name',
        'settings.nameHelp': 'Shown in the header and the browser tab.',
        'settings.uiLang': 'Interface language',
        'settings.uiLangHelp': 'The language of the buttons and labels around the script.',
        'settings.scriptLang': 'Script language',
        'settings.scriptLangHelp': 'The language voice tracking listens for. It does not change the interface.',
        'settings.progress': 'Timeline on the display',
        'settings.browserDefault': 'Browser default',
        'settings.cancel': 'Cancel',
        'settings.save': 'Save',

        'display.waiting': 'Waiting for controller connection...',
        'display.waitingHint': 'Open the controller page to load your manuscript and begin prompting.',
        'display.scheduledIn': 'Scheduled Start In:',
        'display.onAir': 'ON AIR',
        'display.fullscreenHint': 'Press any key for fullscreen',
        'display.cueIn': 'in {s}s:'
    },

    fr: {
        'status.connecting': 'Connexion...',
        'status.connected': 'Connecté',
        'status.disconnected': 'Déconnecté',
        'status.error': 'Erreur de connexion',
        'status.failed': 'Connexion impossible',
        'status.reconnecting': 'Reconnexion dans {s} s...',
        'status.gaveUp': 'Trop de tentatives de reconnexion',
        'status.autonomous': 'Autonome - reconnexion dans {s} s',
        'status.displays': 'Connecté ({n} écran{s}{stale})',
        'status.stale': ', {n} obsolète - à recharger',

        'header.displayUrl': 'URL de l’écran :',
        'header.openDisplay': 'Ouvrir display.html',
        'header.controllerRemote': 'Télécommande :',
        'header.copy': 'Copier',
        'header.copied': 'Copié !',
        'header.otherAddresses': 'Cette machine est aussi sur : {list}',
        'qr.title': 'Scanner pour ouvrir',

        'theme.dark': 'Sombre',
        'theme.light': 'Clair',
        'theme.toLight': 'Passer en thème clair',
        'theme.toDark': 'Passer en thème sombre',
        'theme.toggle': 'Basculer entre thème clair et sombre',

        'preview.title': 'Aperçu direct',
        'preview.mirror': 'Miroir',
        'preview.mirrorTitle': 'Aperçu en miroir',
        'preview.frameTitle': 'Aperçu de l’écran',
        'preview.paused': 'EN PAUSE',
        'preview.scroll': 'DÉFILE',

        'upload.label': 'Importer un manuscrit :',
        'upload.format': 'Mise en forme',
        'upload.formatTitle': 'Options de mise en forme',
        'upload.auto': 'Mise en forme à l’import',
        'upload.caps': 'Convertir en MAJUSCULES',
        'upload.sentences': 'Une phrase par ligne',
        'upload.paragraphs': 'Ajouter des sauts de paragraphe',
        'upload.punctuation': 'Renforcer les pauses de ponctuation',
        'upload.clear': 'Effacer',
        'upload.formatBtn': 'Mettre en forme pour le prompteur',
        'upload.noText': 'Aucun texte à mettre en forme. Importez un manuscrit ou saisissez du texte.',
        'upload.legacyDoc': 'Les fichiers .doc ne sont pas pris en charge. Utilisez .docx ou du texte brut.',
        'upload.readError': 'Erreur de lecture du fichier : ',

        'speed.label': 'Vitesse de lecture',
        'speed.wpm': '{n} mots/min',
        'speed.words': 'Mots',
        'speed.duration': 'Durée',

        'schedule.label': 'Heure de départ programmée :',
        'schedule.clear': 'Effacer',
        'schedule.none': 'Aucun départ programmé',
        'schedule.set': 'Programmé pour : {when}',
        'schedule.past': 'L’heure programmée doit être dans le futur',

        'editor.title': 'Éditeur de script',
        'editor.exportTxt': 'Exporter TXT',
        'editor.exportHtml': 'Exporter HTML',

        'playback.start': 'Démarrer',
        'playback.pause': 'Pause',
        'playback.continue': 'Reprendre',
        'playback.starting': 'Départ',
        'playback.reset': 'Réinitialiser',
        'playback.progress': 'Progression du script',
        'playback.options': 'Options d’affichage',
        'playback.mirror': 'Miroir',
        'playback.mirrorTitle': 'Mode miroir',
        'playback.timer': 'Minuteur',
        'playback.timerTitle': 'Afficher le minuteur',
        'playback.onAir': 'À l’antenne',
        'playback.onAirTitle': 'Voyant d’antenne',
        'playback.line': 'Ligne',
        'playback.lineTitle': 'Ligne de lecture',
        'playback.lineSettings': 'Réglages de la ligne de lecture',
        'playback.position': 'Position',
        'playback.thickness': 'Épaisseur',
        'playback.color': 'Couleur',
        'playback.white': 'Blanc',
        'playback.red': 'Rouge',
        'playback.green': 'Vert',
        'playback.yellow': 'Jaune',
        'playback.voice': 'Voix',
        'playback.voiceTitle': 'Suivi vocal : le script suit ce que vous dites',
        'playback.voiceUnsupported': 'Le suivi vocal nécessite Chrome ou Edge',
        'playback.micRefused': 'Accès au microphone refusé',
        'playback.voiceError': 'Erreur du suivi vocal : {error}',
        'playback.fullscreen': 'Plein écran',
        'playback.fullscreenTitle': 'Plein écran sur l’affichage',
        'playback.settings': 'Réglages',
        'playback.remaining': 'Restant :',
        'playback.elapsed': 'Écoulé :',
        'playback.hotkeys': 'Espace lecture/pause · ↑↓ vitesse · ←→ navigation · R réinitialiser',

        'settings.title': 'Réglages du prompteur',
        'settings.close': 'Fermer',
        'settings.closeLabel': 'Fermer les réglages',
        'settings.name': 'Nom du prompteur',
        'settings.nameHelp': 'Affiché dans l’en-tête et l’onglet du navigateur.',
        'settings.uiLang': 'Langue de l’application',
        'settings.uiLangHelp': 'La langue des boutons et des libellés autour du script.',
        'settings.scriptLang': 'Langue du script',
        'settings.scriptLangHelp': 'La langue que le suivi vocal écoute. Elle ne change pas l’interface.',
        'settings.progress': 'Timeline sur l’écran',
        'settings.browserDefault': 'Langue du navigateur',
        'settings.cancel': 'Annuler',
        'settings.save': 'Enregistrer',

        'display.waiting': 'En attente de la connexion du controller...',
        'display.waitingHint': 'Ouvrez la page controller pour charger votre manuscrit et lancer le prompteur.',
        'display.scheduledIn': 'Départ programmé dans :',
        'display.onAir': 'À L’ANTENNE',
        'display.fullscreenHint': 'Appuyez sur une touche pour le plein écran',
        'display.cueIn': 'dans {s} s :'
    }
};

const I18nStore = { lang: 'en' };

function resolveUiLang(lang) {
    if (I18N[lang]) return lang;
    const browser = (typeof navigator !== 'undefined' ? navigator.language : 'en' || 'en')
        .slice(0, 2)
        .toLowerCase();
    return I18N[browser] ? browser : 'en';
}

function t(key, vars) {
    const table = I18N[I18nStore.lang] || I18N.en;
    // An untranslated key falls back to English rather than to a blank label: a missing
    // word is a nuisance, an empty button is a dead control.
    let text = table[key] ?? I18N.en[key] ?? key;
    for (const [name, value] of Object.entries(vars || {})) {
        text = text.split(`{${name}}`).join(value);
    }
    return text;
}

// Attributes are marked separately from text because one button carries both a visible
// label and a tooltip, and they are never the same string.
const I18N_ATTRS = {
    'data-i18n-title': 'title',
    'data-i18n-aria': 'aria-label',
    'data-i18n-placeholder': 'placeholder'
};

function applyLanguage(lang, root = document) {
    I18nStore.lang = resolveUiLang(lang);
    document.documentElement.lang = I18nStore.lang;

    root.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.dataset.i18n);
    });
    for (const [marker, attribute] of Object.entries(I18N_ATTRS)) {
        root.querySelectorAll(`[${marker}]`).forEach((el) => {
            el.setAttribute(attribute, t(el.getAttribute(marker)));
        });
    }
    // Anything that renders its own strings - the theme toggle, the connection status -
    // redraws itself on this instead of being called one by one from here.
    document.dispatchEvent(new CustomEvent('appLanguageChange', { detail: I18nStore.lang }));
}

if (typeof module !== 'undefined') module.exports = { I18N, t, resolveUiLang, I18nStore };
