// /note's own settings, stored in ~/.look/config like the rest:
//
//   note_default_view=edit|split|preview   how a note opens
//   note_line_numbers=true|false           numbers in the gutter
//   note_word_wrap=true|false              wrap long lines, or scroll sideways
//   note_syntax_highlight=true|false       colour Markdown while you type
//   note_editor_theme=look|vs-dark|...     the editor's colours (see THEMES)
//   note_text_size=small|normal|large      the editor and preview text
//
// A missing or unreadable value is the default, never an error: a config
// edited by hand should not be able to break the editor. Pure, so it runs under
// node.

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
};

export const DEFAULTS = Object.freeze({
    defaultView: 'edit',
    lineNumbers: true,
    wrap: true,
    highlight: true,
    theme: 'look',
    size: 'normal',
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
        theme: oneOf(
            config.get(KEYS.theme),
            THEMES.map((t) => t.id),
            DEFAULTS.theme,
        ),
        size: oneOf(config.get(KEYS.size), SIZES, DEFAULTS.size),
    };
}

/** The same from a `{ key: value }` map, as Settings holds the config. */
export function parseMap(map) {
    return parse(Object.entries(map).map(([key, value]) => ({ key, value })));
}

/** What to write to the config for a settings object (or part of one). */
export function toUpdates(settings) {
    const updates = {};
    for (const [name, key] of Object.entries(KEYS)) {
        if (name in settings) updates[key] = String(settings[name]);
    }
    return updates;
}
