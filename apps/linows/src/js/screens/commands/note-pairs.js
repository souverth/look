// Typing help inside a fenced code block: closing brackets and quotes for you,
// stepping over a closer you type, a block opened by Enter between `{}`, and
// Backspace taking a pair away together. Pure, like note-format-ops.js:
//
//   { from, to, insert, select: [start, end] }   one replacement to make
//   { skip: caret }                              no edit: only move the caret
//   null                                         do what the key always does

const edit = (from, to, insert, a, b = a) => ({ from, to, insert, select: [a, b] });

const OPEN = { '(': ')', '[': ']', '{': '}' };
const QUOTES = new Set(["'", '"', '`']);
const CLOSERS = new Set(Object.values(OPEN));

// Four spaces where that is the habit of the language, otherwise two.
const WIDE = new Set(['py', 'rs', 'java', 'c', 'cpp', 'cs', 'kt', 'swift', 'php', 'scala', 'dart', 'sql']);
const unitFor = (lang) => (WIDE.has(lang) ? '    ' : '  ');

/**
 * `ch` was typed with `[start, end)` selected. A selection is wrapped in the pair;
 * an opener adds its closer; a closer (or quote) that is already next just steps
 * over it. Quotes stay single after a word (`don't`) and in front of one, and a
 * backtick is left alone at the start of a line, where it is a fence.
 */
export function typed(text, start, end, ch) {
    const close = OPEN[ch] ?? (QUOTES.has(ch) ? ch : null);
    if (start !== end) return close ? edit(start, end, ch + text.slice(start, end) + close, start + 1, end + 1) : null;

    const next = text[start] ?? '';
    const prev = text[start - 1] ?? '';
    if ((CLOSERS.has(ch) || QUOTES.has(ch)) && next === ch) return { skip: start + 1 };
    if (!close) return null;

    if (QUOTES.has(ch)) {
        if (/\w/.test(prev) || /\w/.test(next)) return null;
        if (ch === '`') {
            const lineStart = text.lastIndexOf('\n', start - 1) + 1;
            if (/^[\s`]*$/.test(text.slice(lineStart, start))) return null;
        }
    } else if (/\w/.test(next)) {
        return null;
    }
    return edit(start, start, ch + close, start + 1);
}

/**
 * Enter in a block: the new line keeps the indent of this one, one level deeper
 * after an opener (or a `:` in Python and YAML), and between `{}` the closer goes
 * on a line of its own with the caret on an indented one between.
 */
export function enter(text, caret, lang = '') {
    const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
    const line = text.slice(lineStart, caret);
    const indent = line.match(/^[ \t]*/)[0];
    const unit = indent.includes('\t') ? '\t' : unitFor(lang);
    const prev = text[caret - 1] ?? '';
    const next = text[caret] ?? '';

    if (OPEN[prev] && next === OPEN[prev]) {
        const insert = `\n${indent}${unit}\n${indent}`;
        const at = caret + 1 + indent.length + unit.length;
        return edit(caret, caret, insert, at);
    }
    const deeper = OPEN[prev] || ((lang === 'py' || lang === 'yaml') && prev === ':');
    const lead = indent + (deeper ? unit : '');
    if (!lead) return null;
    return edit(caret, caret, `\n${lead}`, caret + 1 + lead.length);
}

/** Backspace between an empty pair, `(|)` or `"|"`, takes both. */
export function backspace(text, caret) {
    const prev = text[caret - 1] ?? '';
    const next = text[caret] ?? '';
    const pair = (OPEN[prev] && next === OPEN[prev]) || (QUOTES.has(prev) && next === prev);
    return pair ? edit(caret - 1, caret + 1, '', caret - 1) : null;
}
