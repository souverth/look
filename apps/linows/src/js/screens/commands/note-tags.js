// HTML tags in /note: the list that opens on `<`, the text a choice inserts, and
// closing a tag when its `>` is typed. Pure, like note-format-ops.js, so the
// rules are tested under node and the editor only applies the answer.

// What the preview draws as HTML (see markdown.js): the inline tags it allows.
export const INLINE_TAGS = ['mark', 'kbd', 'u', 'sub', 'sup', 'ins', 'del', 's', 'small', 'abbr', 'b', 'i', 'em', 'strong'];

// Tags with no closing partner.
export const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

export const TAGS = [
    'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo', 'blockquote',
    'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'dd', 'del',
    'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure',
    'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'iframe', 'img', 'input',
    'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'mark', 'meta', 'nav', 'ol', 'optgroup', 'option',
    'output', 'p', 'picture', 'pre', 'progress', 'q', 's', 'samp', 'section', 'select', 'small', 'source',
    'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead',
    'time', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr',
];

// Attributes worth a place for the caret: `<a href="|">`, `<img src="|">`.
const ATTRS = { a: 'href', img: 'src', iframe: 'src', source: 'src', audio: 'src', video: 'src', link: 'href' };

/**
 * `<` and the letters typed after it, ending at the caret: `{ from, prefix }`
 * (`from` is where the `<` is), or null when the caret is not in one.
 */
export function tagContext(text, caret) {
    const before = text.slice(Math.max(0, caret - 24), caret);
    const m = before.match(/<([a-z][a-z0-9]*)?$/i);
    if (!m) return null;
    const from = caret - m[0].length;
    // `a<b` in a sentence is maths, not a tag: ask for a word break before `<`.
    if (from > 0 && /[\w)\]]/.test(text[from - 1])) return null;
    return { from, prefix: (m[1] || '').toLowerCase() };
}

/** Tags starting with `prefix`, the common inline ones first within a prefix. */
export function filterTags(prefix) {
    return TAGS.filter((t) => t.startsWith(prefix));
}

/** The text a choice inserts, and where the caret goes in it. */
export function tagInsert(tag) {
    if (VOID_TAGS.has(tag)) {
        const attr = ATTRS[tag];
        if (attr) {
            const text = `<${tag} ${attr}="">`;
            return { text, caret: text.indexOf('""') + 1 };
        }
        return { text: `<${tag}>`, caret: `<${tag}>`.length };
    }
    const attr = ATTRS[tag];
    const open = attr ? `<${tag} ${attr}="">` : `<${tag}>`;
    const caret = attr ? open.indexOf('""') + 1 : open.length;
    return { text: `${open}</${tag}>`, caret };
}

/**
 * The `>` of an opening tag was just typed (the caret is where it will go):
 * answers with the closing tag to add after it, or null. Skipped for void tags,
 * for a tag that already has its closing partner right there, and for `<` that
 * is not a tag at all.
 */
export function closeOnGreater(text, caret, { markup = false } = {}) {
    const line = text.slice(text.lastIndexOf('\n', caret - 1) + 1, caret);
    const m = line.match(/<([a-z][\w.]*)(\s[^<>]*)?$/i);
    if (!m) return null;
    const lower = m[1].toLowerCase();
    if (VOID_TAGS.has(lower)) return null;
    let name = lower;
    if (markup) {
        // In HTML/JSX files any tag is a tag, Components included and in their own
        // case, but `Array<User>` and `a < b` are not: a tag does not follow a word,
        // a lower-case name has to be a known one, and `<br />` is already whole.
        const before = line[line.length - m[0].length - 1] ?? '';
        if (/[\w)\]]/.test(before) || /\/\s*$/.test(m[2] ?? '')) return null;
        if (m[1][0] === m[1][0].toLowerCase() && !TAGS.includes(lower)) return null;
        name = m[1];
    } else if (!TAGS.includes(lower)) {
        return null;
    }
    // Already closed, or the caret sits before a `>` that is there: nothing to add.
    if (text[caret] === '>' || text.startsWith(`</${name}>`, caret)) return null;
    return `</${name}>`;
}
