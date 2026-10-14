// In-app shortcuts you can rebind in ~/.look/config (Linux, Windows).
//
//   shortcut_main_copy=ctrl+shift+y
//   shortcut_main_reveal=ctrl+r|alt+r        several chords for one action
//
// The names and the catalog ids follow macOS (`shortcut_<group>_<action>`), and
// so does the grammar: modifiers joined by `+`, then one key. `cmd` is read as
// `ctrl` here, so a dotfile written on a Mac works unchanged; `win`, `super` and
// `meta` are the Windows/Super key. Only the shortcuts you rebind need a line.
//
// What is rebindable is the row verbs and the view toggle. Settings, reload,
// command mode, help, zoom and the Ctrl+K menu keep their chords on this
// platform: they are matched by layout-aware code that the generic matcher
// below does not replace.
//
// Pure: no DOM beyond the shape of a KeyboardEvent, so it runs under node.

/** Catalog order is dispatch order: a chord two actions claim fires the first. */
export const CATALOG = [
    { id: 'main.copy', defaults: ['ctrl+c'], label: 'Copy path' },
    { id: 'main.pick', defaults: ['ctrl+p'], label: 'Pick or unpick a file' },
    { id: 'main.clearPicks', defaults: ['ctrl+shift+p'], label: 'Clear all picks' },
    { id: 'main.openPicked', defaults: ['shift+enter'], label: 'Open all picked' },
    { id: 'main.trash', defaults: ['ctrl+d'], label: 'Trash, kill or remove the selected row' },
    { id: 'main.reveal', defaults: ['ctrl+f'], label: 'Reveal in the file manager' },
    { id: 'main.edit', defaults: ['ctrl+e'], label: 'Edit in your editor' },
    { id: 'main.terminal', defaults: ['ctrl+t'], label: 'Open a terminal here' },
    { id: 'main.webSearch', defaults: ['ctrl+enter'], label: 'Search the web' },
    { id: 'main.hideApp', defaults: ['ctrl+shift+h'], label: 'Hide the selected app' },
    { id: 'main.quickActionToggle', defaults: ['ctrl+o'], label: 'Flip the row toggle' },
    { id: 'clipboard.paste', defaults: ['ctrl+i'], label: 'Paste the selected clip' },
    { id: 'view.toggleLayout', defaults: ['ctrl+shift+c'], label: 'Switch split / compact' },
];

const PREFIX = 'shortcut_';

/** `main.clearPicks` -> `shortcut_main_clear_picks`, as on macOS. */
export function configKeyFor(id) {
    return (
        PREFIX +
        [...id]
            .map((c) => (c === '.' ? '_' : c >= 'A' && c <= 'Z' ? `_${c.toLowerCase()}` : c))
            .join('')
    );
}

const MODIFIERS = {
    ctrl: 'ctrl',
    control: 'ctrl',
    cmd: 'ctrl',
    command: 'ctrl',
    alt: 'alt',
    opt: 'alt',
    option: 'alt',
    shift: 'shift',
    win: 'meta',
    super: 'meta',
    meta: 'meta',
};

// Keys that are not a printable character. `keys` are the `event.key` values.
const NAMED = {
    enter: { code: 'Enter', keys: ['Enter'], label: 'Enter' },
    return: { code: 'Enter', keys: ['Enter'], label: 'Enter' },
    esc: { code: 'Escape', keys: ['Escape'], label: 'Esc' },
    escape: { code: 'Escape', keys: ['Escape'], label: 'Esc' },
    tab: { code: 'Tab', keys: ['Tab'], label: 'Tab' },
    space: { code: 'Space', keys: [' '], label: 'Space' },
    up: { code: 'ArrowUp', keys: ['ArrowUp'], label: 'Up' },
    down: { code: 'ArrowDown', keys: ['ArrowDown'], label: 'Down' },
    left: { code: 'ArrowLeft', keys: ['ArrowLeft'], label: 'Left' },
    right: { code: 'ArrowRight', keys: ['ArrowRight'], label: 'Right' },
};

const PUNCT_CODES = {
    '`': 'Backquote',
    '-': 'Minus',
    '=': 'Equal',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '\\': 'Backslash',
    ';': 'Semicolon',
    "'": 'Quote',
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
};

const MAX_FUNCTION_KEY = 20;

function parseKey(token) {
    if (NAMED[token]) return { kind: 'named', ...NAMED[token] };
    const f = /^f(\d{1,2})$/.exec(token);
    if (f && Number(f[1]) >= 1 && Number(f[1]) <= MAX_FUNCTION_KEY) {
        const code = `F${Number(f[1])}`;
        return { kind: 'named', code, keys: [code], label: code };
    }
    if (/^[a-z]$/.test(token)) return { kind: 'letter', char: token, label: token.toUpperCase() };
    if (/^[0-9]$/.test(token)) return { kind: 'digit', char: token, label: token };
    if (PUNCT_CODES[token]) {
        return { kind: 'punct', char: token, code: PUNCT_CODES[token], label: token };
    }
    return null;
}

/**
 * `ctrl+shift+p` -> a chord, or `{ error }` saying why not. A chord needs a
 * modifier other than Shift (so ordinary typing stays typing), except an F-key,
 * and Shift alone is enough with a key that types nothing (`shift+enter`).
 */
export function parseChord(spec) {
    const tokens = String(spec)
        .toLowerCase()
        .split('+')
        .map((t) => t.trim())
        .filter(Boolean);
    const chord = { ctrl: false, alt: false, shift: false, meta: false, key: null };
    for (const token of tokens) {
        if (MODIFIERS[token]) {
            chord[MODIFIERS[token]] = true;
        } else if (chord.key) {
            return { error: 'it names more than one key' };
        } else {
            chord.key = parseKey(token);
            if (!chord.key) return { error: `"${token}" is not a key Look knows` };
        }
    }
    if (!chord.key) return { error: 'it names no key' };

    const printable = ['letter', 'digit', 'punct'].includes(chord.key.kind);
    const isFunction = chord.key.kind === 'named' && /^F\d+$/.test(chord.key.code);
    const onlyShift = !chord.ctrl && !chord.alt && !chord.meta;
    if (onlyShift && !isFunction && !(chord.shift && !printable)) {
        return { error: 'it needs a modifier other than Shift (only F-keys work alone)' };
    }
    return chord;
}

/** What a key capsule shows: `Ctrl+Shift+P`. */
export function chordLabel(chord) {
    const parts = [];
    if (chord.ctrl) parts.push('Ctrl');
    if (chord.alt) parts.push('Alt');
    if (chord.shift) parts.push('Shift');
    if (chord.meta) parts.push('Win');
    parts.push(chord.key.label);
    return parts.join('+');
}

function keyMatches(key, e) {
    switch (key.kind) {
        case 'letter':
            // The printed letter, so Dvorak and AZERTY follow the legend; a
            // non-Latin layout types no ASCII letter, so the physical key stands in.
            if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase() === key.char;
            return e.code === `Key${key.char.toUpperCase()}`;
        case 'digit':
            return e.key === key.char || e.code === `Digit${key.char}`;
        case 'named':
            return key.keys.includes(e.key) || e.code === key.code;
        default:
            // Punctuation: the physical key always counts (Shift changes what it
            // types), and so does the character.
            return e.code === key.code || e.key === key.char;
    }
}

/** Whether `e` is exactly this chord. `shiftHeld` is the webview's Shift latch. */
export function chordMatches(chord, e, shiftHeld = false) {
    return (
        chord.ctrl === !!e.ctrlKey &&
        chord.alt === !!e.altKey &&
        chord.meta === !!e.metaKey &&
        chord.shift === !!(e.shiftKey || shiftHeld) &&
        keyMatches(chord.key, e)
    );
}

// --- Bindings: the catalog's defaults, then whatever the config rebinds.

let bindings = new Map();
let problems = [];

function parseAll(spec) {
    const chords = [];
    const errors = [];
    for (const part of String(spec).split('|')) {
        if (!part.trim()) continue;
        const chord = parseChord(part);
        if (chord.error) errors.push(`"${part.trim()}": ${chord.error}`);
        else chords.push(chord);
    }
    return { chords, errors };
}

/**
 * Builds the bindings from the config's `{ key, value }` entries. A value that
 * does not parse leaves that shortcut on its default and is reported in
 * `warnings()`; a chord two shortcuts claim is reported too, not refused, since
 * shadowing a shortcut you never use is a fair thing to want.
 */
export function load(entries = []) {
    const config = new Map(entries.map((e) => [e.key, String(e.value ?? '').trim()]));
    const next = new Map();
    const found = [];
    for (const { id, defaults } of CATALOG) {
        const key = configKeyFor(id);
        const given = config.get(key);
        let chords = [];
        if (given) {
            const { chords: parsed, errors } = parseAll(given);
            for (const error of errors) found.push(`${key}: ${error}. Using the default`);
            chords = parsed;
        }
        if (chords.length === 0) chords = parseAll(defaults.join('|')).chords;
        next.set(id, chords);
    }

    const owners = new Map();
    for (const { id } of CATALOG) {
        for (const chord of next.get(id)) {
            const label = chordLabel(chord);
            const owner = owners.get(label);
            if (owner && owner !== id) {
                found.push(`${label} is bound to both ${owner} and ${id}; ${owner} wins`);
            } else {
                owners.set(label, id);
            }
        }
    }
    bindings = next;
    problems = found;
}

/** Same, from a `{ key: value }` map. */
export function loadMap(map) {
    load(Object.entries(map).map(([key, value]) => ({ key, value })));
}

load();

export const chordsOf = (id) => bindings.get(id) ?? [];

/** What went wrong reading the config, for a banner. */
export const warnings = () => [...problems];

/** `Ctrl+E`, or the first of several chords; empty for an unknown id. */
export function display(id) {
    const chord = chordsOf(id)[0];
    return chord ? chordLabel(chord) : '';
}

export function matches(e, id, shiftHeld = false) {
    return chordsOf(id).some((chord) => chordMatches(chord, e, shiftHeld));
}

/** The first catalog action whose chord is `e`, or null. */
export function actionFor(e, shiftHeld = false) {
    for (const { id } of CATALOG) {
        if (matches(e, id, shiftHeld)) return id;
    }
    return null;
}

/**
 * Rewrites every `[data-shortcut]` element's text to its action's chord, so the
 * help screen and the Settings list follow a rebind.
 */
export function labelAll(root) {
    for (const el of root.querySelectorAll('[data-shortcut]')) {
        const label = display(el.dataset.shortcut);
        if (label) el.textContent = label;
    }
}

/** Reads the config's shortcuts, relabels the screens, and returns what was wrong. */
export function applyConfig(entries, root = document) {
    load(entries);
    labelAll(root);
    return warnings();
}

/** One line for a banner: the first problem, and how many more there are. */
export function describeProblems(problems) {
    if (problems.length === 0) return null;
    const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : '';
    return `${problems[0]}${more}`;
}
