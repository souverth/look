// /note's own settings, stored in ~/.look/config like the rest:
//
//   note_default_view=edit|split|preview   how a note opens
//   note_line_numbers=true|false           numbers in the gutter
//   note_word_wrap=true|false              wrap long lines, or scroll sideways
//   note_syntax_highlight=true|false       colour Markdown while you type
//   note_editor_theme=look|vs-dark|...|user:Name   the editor's colours (see THEMES; `user:` is
//                                          a theme the user saved)
//   note_theme_colors=--var:#hex;...       colours changed on top of the theme (theme-colors.js)
//   note_text_size=small|normal|large      the editor and preview text
//
// A missing or unreadable value is the default, never an error: a config
// edited by hand should not be able to break the editor. Pure, so it runs under
// node.

import { NOTE_COLORS, decodeColors, encodeColors } from '../../theme-colors.js';

export const VIEWS = ['edit', 'split', 'preview'];
export const SIZES = ['small', 'normal', 'large'];

/** `look` borrows the launcher's own theme; the rest are editor palettes. */
export const THEMES = [
    { id: 'look', label: 'Follow Look' },
    { id: 'vs-dark', label: 'VS Dark+' },
    { id: 'vs-light', label: 'VS Light+' },
    { id: 'monokai', label: 'Monokai' },
    { id: 'solarized-dark', label: 'Solarized Dark' },
    { id: 'solarized-light', label: 'Solarized Light' },
    { id: 'github-dark', label: 'GitHub Dark' },
    { id: 'github-light', label: 'GitHub Light' },
];

export const KEYS = {
    defaultView: 'note_default_view',
    lineNumbers: 'note_line_numbers',
    wrap: 'note_word_wrap',
    highlight: 'note_syntax_highlight',
    theme: 'note_editor_theme',
    size: 'note_text_size',
    colors: 'note_theme_colors',
};

export const DEFAULTS = Object.freeze({
    defaultView: 'edit',
    lineNumbers: true,
    wrap: true,
    highlight: true,
    theme: 'look',
    size: 'normal',
    colors: Object.freeze({}),
});

const oneOf = (value, allowed, fallback) => {
    const v = String(value ?? '')
        .trim()
        .toLowerCase();
    return allowed.includes(v) ? v : fallback;
};

const bool = (value, fallback) => {
    const v = String(value ?? '')
        .trim()
        .toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
    return fallback;
};

/** Settings from the config's `{ key, value }` entries. */
export function parse(entries = []) {
    const config = new Map(entries.map((e) => [e.key, e.value]));
    return {
        defaultView: oneOf(config.get(KEYS.defaultView), VIEWS, DEFAULTS.defaultView),
        lineNumbers: bool(config.get(KEYS.lineNumbers), DEFAULTS.lineNumbers),
        wrap: bool(config.get(KEYS.wrap), DEFAULTS.wrap),
        highlight: bool(config.get(KEYS.highlight), DEFAULTS.highlight),
        theme: themeId(config.get(KEYS.theme)),
        size: oneOf(config.get(KEYS.size), SIZES, DEFAULTS.size),
        colors: decodeColors(config.get(KEYS.colors), NOTE_COLORS),
    };
}

/** A built-in theme, `user:Name` for one the user saved (the file is looked for later), else the default. */
function themeId(value) {
    const v = String(value ?? '').trim();
    if (/^user:\S.{0,59}$/.test(v)) return v;
    return oneOf(
        v,
        THEMES.map((t) => t.id),
        DEFAULTS.theme,
    );
}

/** `Name` for a `user:Name` theme id, else null. */
export const userThemeName = (id) => (String(id).startsWith('user:') ? String(id).slice(5) : null);

/**
 * What a theme file holds, as `{ base, colors }`, however much of it is usable: a file
 * edited by hand or half written gives the plain default, never an error.
 */
export function parseUserTheme(text) {
    let data = {};
    try {
        data = JSON.parse(text);
    } catch {
        // not JSON: an empty theme
    }
    const base = THEMES.some((t) => t.id === data?.base) ? data.base : 'look';
    return { base, colors: decodeColors(encodeColors(data?.colors, NOTE_COLORS), NOTE_COLORS) };
}

/**
 * The look the editor is to have for `settings`: the built-in theme to start from and the
 * colours to lay over it (the saved theme's, then the ones changed since). `userThemes` is
 * `[{ name, data }]`; a saved theme that is gone is the default.
 */
export function resolveTheme(settings, userThemes = []) {
    const name = userThemeName(settings.theme);
    let base = settings.theme;
    let colors = {};
    if (name !== null) {
        const found = userThemes.find((t) => t.name.toLowerCase() === name.toLowerCase());
        const parsed = found ? parseUserTheme(found.data) : { base: 'look', colors: {} };
        base = parsed.base;
        colors = parsed.colors;
    }
    return { base, colors: { ...colors, ...settings.colors } };
}

/** The same from a `{ key: value }` map, as Settings holds the config. */
export function parseMap(map) {
    return parse(Object.entries(map).map(([key, value]) => ({ key, value })));
}

/** What to write to the config for a settings object (or part of one). */
export function toUpdates(settings) {
    const updates = {};
    for (const [name, key] of Object.entries(KEYS)) {
        if (!(name in settings)) continue;
        updates[key] = name === 'colors' ? encodeColors(settings.colors, NOTE_COLORS) : String(settings[name]);
    }
    return updates;
}
