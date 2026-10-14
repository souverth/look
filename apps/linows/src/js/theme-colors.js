// The colours a theme is made of, for the editors in Settings: which CSS variables
// there are to change (for the launcher and for the /note editor), how a colour is
// read and written, and how a set of changed colours goes into one line of the config
// file and comes back. Pure, so it runs under node.
//
// A set of colours in the config is `--accent-color:#89b4fa;--panel-fill:#31324480`:
// `name:colour` pairs joined by `;`, with no spaces (a `#` after a space would start a
// comment in that file).

/**
 * The launcher's colours. `alpha`: the colour is meant to be see-through, so it gets an
 * opacity control. Each is a variable of the theme blocks in css/theme.css.
 */
export const LOOK_COLORS = [
    {
        group: 'Accent and status',
        items: [
            { name: '--accent-color', label: 'Accent' },
            { name: '--on-accent-color', label: 'Text on accent' },
            { name: '--color-success', label: 'Success' },
            { name: '--color-warning', label: 'Warning' },
            { name: '--color-danger', label: 'Danger' },
            { name: '--color-info', label: 'Info' },
        ],
    },
    {
        group: 'Text',
        items: [
            { name: '--font-secondary', label: 'Secondary text' },
            { name: '--font-muted', label: 'Muted text', alpha: true },
        ],
    },
    {
        group: 'Surfaces',
        items: [
            { name: '--panel-fill', label: 'Panels', alpha: true },
            { name: '--control-fill', label: 'Controls', alpha: true },
            { name: '--overlay-surface', label: 'Pop-ups', alpha: true },
            { name: '--divider-color', label: 'Lines', alpha: true },
            { name: '--selection-fill', label: 'Selection', alpha: true },
        ],
    },
    {
        group: 'Code',
        items: [
            { name: '--syntax-keyword', label: 'Keywords' },
            { name: '--syntax-string', label: 'Strings' },
            { name: '--syntax-number', label: 'Numbers' },
            { name: '--syntax-comment', label: 'Comments' },
        ],
    },
];

/** The /note editor's colours: what an editor theme in css/components/note-editor.css sets, and more. */
export const NOTE_COLORS = [
    {
        group: 'Page',
        items: [
            { name: '--panel-fill', label: 'Background', alpha: true },
            { name: '--overlay-surface', label: 'Menus and lists', alpha: true },
            { name: '--control-fill', label: 'Controls', alpha: true },
            { name: '--divider-color', label: 'Lines', alpha: true },
            { name: '--ed-selection', label: 'Selection', alpha: true },
            { name: '--ed-active-line', label: 'Current line', alpha: true },
        ],
    },
    {
        group: 'Text',
        items: [
            { name: '--font-color', label: 'Text' },
            { name: '--font-secondary', label: 'Secondary text' },
            { name: '--font-muted', label: 'Line numbers and hints' },
            { name: '--accent-color', label: 'Accent' },
            { name: '--on-accent-color', label: 'Text on accent' },
        ],
    },
    {
        group: 'Status',
        items: [
            { name: '--color-info', label: 'Info' },
            { name: '--color-success', label: 'Success' },
            { name: '--color-warning', label: 'Warning' },
            { name: '--color-danger', label: 'Danger' },
        ],
    },
    {
        group: 'Headings',
        items: [1, 2, 3, 4, 5, 6].map((n) => ({ name: `--tok-h${n}`, label: `Heading ${n}` })),
    },
    {
        group: 'Markdown',
        items: [
            { name: '--tok-marker', label: 'Marks (#, -, >)' },
            { name: '--tok-bold', label: 'Bold' },
            { name: '--tok-italic', label: 'Italic' },
            { name: '--tok-strike', label: 'Strikethrough' },
            { name: '--tok-mark', label: 'Highlight' },
            { name: '--tok-code', label: 'Inline code' },
            { name: '--tok-link', label: 'Link text' },
            { name: '--tok-url', label: 'Link address' },
            { name: '--tok-quote', label: 'Quote and comment' },
        ],
    },
    {
        group: 'List levels',
        items: [0, 1, 2, 3, 4, 5].map((n) => ({ name: `--lv${n}`, label: `Level ${n + 1}` })),
    },
    {
        group: 'Code blocks',
        items: [
            { name: '--syntax-keyword', label: 'Keywords' },
            { name: '--syntax-string', label: 'Strings' },
            { name: '--syntax-number', label: 'Numbers' },
            { name: '--syntax-comment', label: 'Comments' },
            { name: '--tok-cfn', label: 'Function names' },
            { name: '--tok-ctype', label: 'Types' },
            { name: '--tok-ctag', label: 'Tags' },
            { name: '--tok-cb0', label: 'Brackets, level 1' },
            { name: '--tok-cb1', label: 'Brackets, level 2' },
            { name: '--tok-cb2', label: 'Brackets, level 3' },
        ],
    },
];

/** Every variable name of a catalog, in order. */
export const namesOf = (catalog) => catalog.flatMap((g) => g.items.map((i) => i.name));

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

/**
 * `{ r, g, b, a }` (0-255, a 0-1) for what CSS says a colour is: `#abc`, `#aabbcc`,
 * `#aabbccdd`, `rgb(...)`, `rgba(...)` and the `color(srgb ...)` a browser reports for a
 * mixed colour. Null for anything else (a name, a gradient, nonsense).
 */
export function parseColor(text) {
    const s = String(text ?? '').trim().toLowerCase();
    let m = s.match(/^#([0-9a-f]{3,4})$/);
    if (m) {
        const [r, g, b, a = 255] = m[1].split('').map((c) => parseInt(c + c, 16));
        return { r, g, b, a: a / 255 };
    }
    m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
    if (m) {
        const n = parseInt(m[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
    }
    m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/);
    if (m) {
        const a = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
        return { r: clamp(Number(m[1]), 0, 255), g: clamp(Number(m[2]), 0, 255), b: clamp(Number(m[3]), 0, 255), a: clamp(a, 0, 1) };
    }
    m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/);
    if (m) {
        return {
            r: clamp(Number(m[1]) * 255, 0, 255),
            g: clamp(Number(m[2]) * 255, 0, 255),
            b: clamp(Number(m[3]) * 255, 0, 255),
            a: m[4] === undefined ? 1 : clamp(Number(m[4]), 0, 1),
        };
    }
    return null;
}

/** `#rrggbb`, or `#rrggbbaa` when the colour is not fully solid. */
export function toHex({ r, g, b, a = 1 }) {
    const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    return a >= 0.998 ? base : `${base}${hex2(a * 255)}`;
}

/** The colour written as `#rrggbb`/`#rrggbbaa`, or null when it is not a colour. */
export function normalizeColor(text) {
    const c = parseColor(text);
    return c ? toHex(c) : null;
}

/** The same colour with another opacity (0-1). */
export function withAlpha(text, alpha) {
    const c = parseColor(text);
    return c ? toHex({ ...c, a: clamp(alpha, 0, 1) }) : null;
}

/** `{ name: colour }` as the line the config file keeps; names outside `catalog` and non-colours are left out. */
export function encodeColors(colors, catalog) {
    const allowed = new Set(namesOf(catalog));
    return Object.entries(colors ?? {})
        .filter(([name]) => allowed.has(name))
        .map(([name, value]) => [name, normalizeColor(value)])
        .filter(([, value]) => value)
        .map(([name, value]) => `${name}:${value}`)
        .join(';');
}

/** The reverse. Whatever is not a known name with a real colour is dropped: the file may have been edited by hand. */
export function decodeColors(line, catalog) {
    const allowed = new Set(namesOf(catalog));
    const out = {};
    for (const pair of String(line ?? '').split(';')) {
        const at = pair.indexOf(':');
        if (at < 1) continue;
        const name = pair.slice(0, at).trim();
        const value = normalizeColor(pair.slice(at + 1));
        if (allowed.has(name) && value) out[name] = value;
    }
    return out;
}

/** WCAG contrast ratio between two colours (1 to 21), for a hint when text would be hard to read. */
export function contrast(a, b) {
    const lum = ({ r, g, b: blue }) => {
        const f = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(blue);
    };
    const ca = parseColor(a);
    const cb = parseColor(b);
    if (!ca || !cb) return null;
    const [hi, lo] = [lum(ca), lum(cb)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}
