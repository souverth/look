// Whole-line edits for /note's textarea: move, copy, delete, open a line, join,
// comment. Like note-format-ops.js each takes the note's text and the selection and
// answers with the one replacement to make, or null when there is nothing to do:
//
//   { from, to, insert, select: [start, end] }
//
// A selection touching several lines moves/copies them all as one block.

import { lineRange } from './note-format-ops.js';

const edit = (from, to, insert, a, b = a) => ({ from, to, insert, select: [a, b] });

/** Alt+Up / Alt+Down: swap the lines of the selection with the line beside them. */
export function moveLines(text, start, end, dir) {
    const [a, b] = lineRange(text, start, end);
    const block = text.slice(a, b);
    if (dir === 'up') {
        if (a === 0) return null;
        const prevStart = text.lastIndexOf('\n', a - 2) + 1;
        const prev = text.slice(prevStart, a - 1);
        const shift = prev.length + 1;
        return edit(prevStart, b, `${block}\n${prev}`, start - shift, end - shift);
    }
    if (b >= text.length) return null;
    let nextEnd = text.indexOf('\n', b + 1);
    if (nextEnd < 0) nextEnd = text.length;
    const next = text.slice(b + 1, nextEnd);
    const shift = next.length + 1;
    return edit(a, nextEnd, `${next}\n${block}`, start + shift, end + shift);
}

/**
 * Alt+Enter (down) / Shift+Alt+Up (up) / Shift+Alt+Down (down): copy the lines
 * of the selection above or below themselves. The selection follows the copy
 * that is typed in next: down lands on the new lines, up stays on the upper ones.
 */
export function duplicateLines(text, start, end, dir = 'down') {
    const [a, b] = lineRange(text, start, end);
    const block = text.slice(a, b);
    if (dir === 'up') return edit(a, a, `${block}\n`, start, end);
    const shift = block.length + 1;
    return edit(b, b, `\n${block}`, start + shift, end + shift);
}

/** Ctrl+Shift+K: remove the lines of the selection, and the line break with them. */
export function deleteLines(text, start, end) {
    const [a, b] = lineRange(text, start, end);
    if (b < text.length) return edit(a, b + 1, '', a);
    if (a > 0) return edit(a - 1, b, '', a - 1);
    return edit(a, b, '', a);
}

/** Ctrl+Enter / Ctrl+Shift+Enter: a new line below / above, at the line's indent. */
export function openLine(text, start, end, above = false) {
    const [a, b] = lineRange(text, start, end);
    const indent = text.slice(a, b).match(/^[ \t]*/)[0];
    if (above) return edit(a, a, `${indent}\n`, a + indent.length);
    return edit(b, b, `\n${indent}`, b + 1 + indent.length);
}

/** Ctrl+J: the next line (or every selected one) onto the current, a space apart. */
export function joinLines(text, start, end) {
    let [a, b] = lineRange(text, start, end);
    if (start === end || !text.slice(start, end).includes('\n')) {
        // Nothing, or one line, selected: take the line after it in.
        if (b >= text.length) return null;
        let next = text.indexOf('\n', b + 1);
        if (next < 0) next = text.length;
        b = next;
    }
    const joined = text
        .slice(a, b)
        .split('\n')
        .map((line, i) => (i === 0 ? line.replace(/\s+$/, '') : line.trim()))
        .filter((line, i) => i === 0 || line !== '')
        .join(' ');
    const caret = a + joined.length;
    return edit(a, b, joined, caret);
}

const COMMENT = /^(\s*)<!--\s?(.*?)\s?-->\s*$/;

/** Ctrl+/: wrap each non-empty line in <!-- -->, or take it off when all are. */
export function toggleComment(text, start, end) {
    const [a, b] = lineRange(text, start, end);
    const lines = text.slice(a, b).split('\n');
    const filled = lines.filter((l) => l.trim() !== '');
    if (!filled.length) return null;
    const off = filled.every((l) => COMMENT.test(l));
    const out = lines.map((l) => {
        if (l.trim() === '') return l;
        if (off) return l.replace(COMMENT, (_, indent, body) => indent + body);
        const indent = l.match(/^\s*/)[0];
        return `${indent}<!-- ${l.slice(indent.length)} -->`;
    });
    const insert = out.join('\n');
    return edit(a, b, insert, a, a + insert.length);
}

const indentWidth = (s) => s.replace(/\t/g, '    ').length;

/**
 * The number item `at` (indented `width`) should carry, from the lines above it:
 * one past an ordered item at the same indent, 1 right under a parent (or beside a
 * bullet, a different list), null when nothing above says. Blank lines are skipped;
 * anything else that is not an item ends the search.
 */
function numberFor(all, at, width) {
    for (let j = at - 1; j >= 0; j--) {
        const line = all[j];
        if (line.trim() === '') continue;
        const item = line.match(/^(\s*)(?:([-*+])|(\d+)[.)])\s/);
        if (!item) return null;
        const w = indentWidth(item[1]);
        if (w > width) continue; // a deeper item of an earlier sibling
        if (w < width) return 1; // the parent: this is its first child
        return item[3] ? Number(item[3]) + 1 : 1;
    }
    return null;
}

const HEADING = /^(#{1,6})(?=\s|$)/;
const LIST = /^[ \t]*(?:[-*+]|\d+[.)])\s/;

/**
 * Tab / Shift+Tab (`dir` +1 / -1) as a change of level, per line: a list item
 * moves one level in or out (two spaces, so its colour follows), a heading gains
 * or loses one `#`. Other lines of a multi-line selection are indented the plain
 * way. Null when it is one ordinary line, so the key keeps its old job there.
 */
export function shiftLevel(text, start, end, dir) {
    const [a, b] = lineRange(text, start, end);
    const lines = text.slice(a, b).split('\n');
    const special = (l) => HEADING.test(l) || LIST.test(l);
    if (lines.length === 1 && !special(lines[0])) return null;

    // The whole text by line, kept up to date as lines change, so a numbered item
    // can look at the items above it.
    const all = text.split('\n');
    const firstLine = text.slice(0, a).split('\n').length - 1;
    const deltas = [];
    const out = lines.map((line, index) => {
        let next = line;
        const heading = line.match(HEADING);
        if (heading) {
            if (dir > 0 && heading[1].length < 6) next = `#${line}`;
            else if (dir < 0 && heading[1].length > 1) next = line.slice(1);
        } else if (dir > 0) {
            next = line === '' ? line : `  ${line}`;
        } else if (/^([-*+]|\d+[.)])\s*$/.test(line)) {
            // An empty item already at the margin has nowhere left to go: Shift+Tab
            // drops its marker and leaves a plain empty line, as Enter on it does.
            next = '';
        } else {
            next = line.replace(/^( {1,2}|\t)/, '');
        }
        // A numbered item that changed level is numbered for its new place: 1 as the
        // first child, or the next number among the items it now sits beside.
        const numbered = next !== line && next.match(/^(\s*)(\d+)([.)])(\s.*|)$/);
        if (numbered) {
            const n = numberFor(all, firstLine + index, indentWidth(numbered[1]));
            if (n !== null) next = `${numbered[1]}${n}${numbered[3]}${numbered[4]}`;
        }
        all[firstLine + index] = next;
        deltas.push(next.length - line.length);
        return next;
    });
    const insert = out.join('\n');
    if (insert === text.slice(a, b)) return edit(a, b, insert, start, end);
    // Where a position of the old text lands: past the lines before it, and past
    // the change made on its own line. A selection that starts at the very start
    // of a line keeps that start, so the text added there stays selected.
    const starts = [];
    let at = a;
    for (const l of lines) {
        starts.push(at);
        at += l.length + 1;
    }
    const land = (pos, isSelectionStart) => {
        let i = starts.length - 1;
        while (i > 0 && starts[i] > pos) i--;
        const before = deltas.slice(0, i).reduce((n, d) => n + d, 0);
        const lineStart = starts[i] + before;
        if (isSelectionStart && pos === starts[i]) return lineStart;
        return Math.max(lineStart, pos + before + deltas[i]);
    };
    const ranged = start !== end;
    return edit(a, b, insert, land(start, ranged), land(end, false));
}

/**
 * Ctrl+Shift+1..6: the lines of the selection become heading `level`, or plain when they
 * all are that level already. A heading of another level is changed, not stacked.
 */
export function setHeading(text, start, end, level) {
    const [a, b] = lineRange(text, start, end);
    const lines = text.slice(a, b).split('\n');
    const filled = lines.filter((l) => l.trim() !== '');
    const mark = '#'.repeat(level);
    const already = filled.length > 0 && filled.every((l) => new RegExp(`^${mark}\\s`).test(l));
    const out = lines.map((line) => {
        if (line.trim() === '') return line;
        const bare = line.replace(/^#{1,6}\s+/, '');
        return already ? bare : `${mark} ${bare}`;
    });
    const insert = out.join('\n');
    // The caret goes to the end of what was changed, where typing carries on.
    return edit(a, b, insert, a + insert.length);
}

/**
 * Alt+Shift+A: the selected lines (or the caret's) as one comment over several lines,
 * `<!--` on a line before them and `-->` on a line after, or, when they are wrapped
 * like that already, the two marker lines taken off.
 */
export function toggleBlockComment(text, start, end) {
    const [a, b] = lineRange(text, start, end);
    const lines = text.slice(a, b).split('\n');
    const indent = lines.find((l) => l.trim() !== '')?.match(/^\s*/)[0] ?? '';

    // The markers are inside the selection (the whole comment was selected)...
    if (lines.length >= 2 && lines[0].trim() === '<!--' && lines[lines.length - 1].trim() === '-->') {
        const inner = lines.slice(1, -1).join('\n');
        return edit(a, b, inner, a, a + inner.length);
    }
    // ...or on the line before and the line after it.
    const before = text.lastIndexOf('\n', a - 2);
    const prevLine = a > 0 ? text.slice(before + 1, a - 1) : null;
    const nextEnd = text.indexOf('\n', b + 1);
    const nextLine = b < text.length ? text.slice(b + 1, nextEnd < 0 ? text.length : nextEnd) : null;
    if (prevLine !== null && nextLine !== null && prevLine.trim() === '<!--' && nextLine.trim() === '-->') {
        const from = before + 1;
        const to = nextEnd < 0 ? text.length : nextEnd;
        const inner = text.slice(a, b);
        return edit(from, to, inner, from, from + inner.length);
    }

    const insert = `${indent}<!--\n${text.slice(a, b)}\n${indent}-->`;
    // The block that was commented stays selected, between the markers.
    return edit(a, b, insert, a + indent.length + 5, a + indent.length + 5 + (b - a));
}
