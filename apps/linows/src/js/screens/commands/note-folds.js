// Folding in /note: which parts of a note can be collapsed, and how the editor shows a
// note with some parts collapsed. Pure, so the part that must never lose text (the
// mapping between what is on screen and the note itself) is tested under node.
//
// A textarea cannot hide a line, so a folded note is shown as a shorter text: the
// lines inside a fold are left out of what the textarea holds. The note itself, in
// full, is kept by the editor view, and everything here maps one to the other.
//
//   source   the whole note
//   display  the source without the lines hidden by folds
//   folded   a Set of the line numbers (from 0) that start a folded region

import { findCommentBlocks } from '../../markdown.js';

const blank = (line) => line.trim() === '';
const width = (s) => s.replace(/\t/g, '    ').length;

/**
 * Everything that can fold: `{ start, end, kind }`, `start` the line that stays and
 * `start + 1 .. end` the lines that fold away. Sorted by `start`, one per start line.
 * Kinds: heading (to the next heading of its level or higher), code (a fenced block),
 * list (an item and what is indented under it), quote, table, details.
 */
export function foldRegions(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const regions = [];
    const taken = new Set();
    const add = (start, end, kind) => {
        // Trailing blank lines stay visible: they separate the region from what follows.
        while (end > start && blank(lines[end])) end--;
        if (end > start && !taken.has(start)) {
            taken.add(start);
            regions.push({ start, end, kind });
        }
    };

    // Fenced blocks first: what is inside one is code, never a heading or a list.
    const inFence = new Array(lines.length).fill(false);
    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*```/.test(lines[i])) continue;
        let j = i + 1;
        while (j < lines.length && !/^\s*```/.test(lines[j])) j++;
        const last = Math.min(j, lines.length - 1);
        for (let k = i; k <= last; k++) inFence[k] = true;
        add(i, last, 'code');
        i = j;
    }

    // A comment over several lines folds as one, and what is in it is neither heading nor list.
    for (const { start, end } of findCommentBlocks(lines)) {
        for (let k = start; k <= end; k++) inFence[k] = true;
        add(start, end, 'comment');
    }

    const heading = (i) => (inFence[i] ? null : lines[i].match(/^(#{1,6})\s+\S/));
    for (let i = 0; i < lines.length; i++) {
        const h = heading(i);
        if (!h) continue;
        let end = lines.length - 1;
        for (let j = i + 1; j < lines.length; j++) {
            const next = heading(j);
            if (next && next[1].length <= h[1].length) {
                end = j - 1;
                break;
            }
        }
        add(i, end, 'heading');
    }

    for (let i = 0; i < lines.length; i++) {
        if (inFence[i] || taken.has(i)) continue;
        const line = lines[i];
        const item = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+\S/);
        if (item) {
            // What is indented under the item belongs to it, blank lines between included
            // as long as more indented text follows.
            const base = width(item[1]);
            let end = i;
            for (let j = i + 1; j < lines.length; j++) {
                if (inFence[j] && !/^\s/.test(lines[j])) break;
                if (blank(lines[j])) continue;
                if (width(lines[j].match(/^\s*/)[0]) > base) end = j;
                else break;
            }
            add(i, end, 'list');
        } else if (/^\s*>/.test(line) && !/^\s*>/.test(lines[i - 1] ?? '')) {
            let end = i;
            while (end + 1 < lines.length && /^\s*>/.test(lines[end + 1])) end++;
            add(i, end, 'quote');
        } else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
            let end = i + 1;
            while (end + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[end + 1])) end++;
            add(i, end, 'table');
        } else if (/^\s*<details[\s>]/i.test(line)) {
            let end = i + 1;
            while (end < lines.length && !/<\/details>/i.test(lines[end])) end++;
            add(i, Math.min(end, lines.length - 1), 'details');
        }
    }

    return regions.sort((a, b) => a.start - b.start);
}

/**
 * How `text` looks with `folded` folded: `{ display, visible, effective }`. `visible`
 * lists the lines still shown, each as `{ line, src, disp, length }` (its offset in the
 * source, in the display, and its length). `effective` maps each fold that is in force
 * (one inside another folded region is not) to its last hidden line. A fold with no
 * region behind it (the note changed) is ignored.
 */
export function layout(text, folded, regions = foldRegions(text)) {
    const source = String(text).replace(/\r\n?/g, '\n');
    const lines = source.split('\n');
    const byStart = new Map(regions.map((r) => [r.start, r]));
    const hidden = new Array(lines.length).fill(false);
    const effective = new Map();
    for (const start of [...folded].sort((a, b) => a - b)) {
        const region = byStart.get(start);
        if (!region || hidden[start]) continue;
        effective.set(start, region.end);
        for (let k = start + 1; k <= region.end; k++) hidden[k] = true;
    }
    const visible = [];
    const shown = [];
    let src = 0;
    let disp = 0;
    for (let i = 0; i < lines.length; i++) {
        if (!hidden[i]) {
            visible.push({ line: i, src, disp, length: lines[i].length });
            shown.push(lines[i]);
            disp += lines[i].length + 1;
        }
        src += lines[i].length + 1;
    }
    return { display: shown.join('\n'), visible, effective, lineCount: lines.length };
}

/** The offset in the note of an offset in the display. */
export function toSource(map, offset) {
    const row = findRow(map.visible, 'disp', offset);
    return row.src + Math.min(offset - row.disp, row.length);
}

/** The offset in the display of an offset in the note (inside a fold: the end of the line that holds it). */
export function toDisplay(map, offset) {
    const row = findRow(map.visible, 'src', offset);
    return row.disp + Math.min(offset - row.src, row.length);
}

/** The last row that starts at or before `offset`. */
function findRow(rows, key, offset) {
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (rows[mid][key] <= offset) lo = mid;
        else hi = mid - 1;
    }
    return rows[lo];
}

/** The display line (from 0) an offset in the display is on. */
export function displayLineOf(display, offset) {
    let n = 0;
    for (let i = 0; i < offset && i < display.length; i++) if (display[i] === '\n') n++;
    return n;
}

/**
 * The note after the display was edited from `before` to `after`, and where the lines
 * moved. The edit is found as what differs between the two texts, and carried into the
 * note at the same place. Returns null when the edit would reach a hidden line (the
 * caller must then not apply it): `{ source, line, delta }`, where `line` is the note's
 * line the edit began on and `delta` how many lines it added (negative: removed).
 */
export function applyDisplayEdit(source, map, after) {
    const before = map.display;
    let p = 0;
    const max = Math.min(before.length, after.length);
    while (p < max && before[p] === after[p]) p++;
    let s = 0;
    while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;

    const from = toSource(map, p);
    const to = toSource(map, before.length - s);
    const inserted = after.slice(p, after.length - s);

    // Everything between `from` and `to` must be shown text: one that spans a hidden line
    // would delete it.
    const firstLine = lineAt(map, p);
    const lastLine = lineAt(map, before.length - s);
    const rowsBetween = map.visible.filter((r) => r.disp >= map.visible[firstLine].disp && r.disp <= map.visible[lastLine].disp);
    for (let k = 1; k < rowsBetween.length; k++) {
        if (rowsBetween[k].line !== rowsBetween[k - 1].line + 1) return null;
    }

    const removedLines = (source.slice(from, to).match(/\n/g) || []).length;
    const addedLines = (inserted.match(/\n/g) || []).length;
    const grew = inserted.length - (to - from); // how much longer the note became
    const shifted = after.length - before.length; // and the display
    const suffixAt = after.length - s; // where, in `after`, the unchanged tail begins
    return {
        source: source.slice(0, from) + inserted + source.slice(to),
        line: map.visible[firstLine].line,
        delta: addedLines - removedLines,
        // Where an offset in `after` (the edited display) falls in the edited note: before
        // the change it is where it was, after it the same distance from the end, and
        // inside the new text it is that far into what was inserted.
        toNewSource(offset) {
            if (offset <= p) return toSource(map, offset);
            if (offset >= suffixAt) return toSource(map, offset - shifted) + grew;
            return from + (offset - p);
        },
    };
}

function lineAt(map, offset) {
    let lo = 0;
    let hi = map.visible.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (map.visible[mid].disp <= offset) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

/** `folded` with its starts after `line` moved by `delta` lines (the lines an edit added or removed). */
export function shiftFolds(folded, line, delta) {
    const next = new Set();
    for (const start of folded) next.add(start > line ? start + delta : start);
    return next;
}

/**
 * The folds that an edit over the display range `[from, to]` would cross: the starts of
 * folds in force on the display lines that range touches. They have to open before such
 * an edit happens. (A delete or backspace also reaches the line break on either side of
 * the caret: pass `from - 1` and `to + 1` for those.)
 */
export function foldsTouched(map, display, from, to) {
    const first = displayLineOf(display, Math.max(0, from));
    const last = displayLineOf(display, Math.min(display.length, to));
    const touched = [];
    for (let i = first; i <= last && i < map.visible.length; i++) {
        if (map.effective.has(map.visible[i].line)) touched.push(map.visible[i].line);
    }
    return touched;
}
