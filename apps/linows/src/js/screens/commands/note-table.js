// Markdown tables in /note: Enter on a typed header row builds the table, Enter
// and Tab inside one add rows and move between cells, and every time the whole
// table is re-laid out so each column is as wide as its widest cell.
//
// Like note-format-ops.js these take the note's text and the caret and answer
// with one replacement, `{ from, to, insert, select: [start, end] }`, or `null`
// when the key should do what it always does.

import { splitRow } from '../../markdown.js';

const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}]/u;

// Columns a character takes in a monospace face: CJK and emoji take two.
const width = (s) => [...s].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0);

const isRow = (line) => /^\s*\|.*\|\s*$/.test(line) && line.trim().length >= 2;
const isSeparatorCell = (c) => /^:?-+:?$/.test(c);

// "| a | b \| c |" -> ['a', 'b \| c']
const cellsOf = splitRow;

function alignOf(cell) {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
}

function separatorCell(align, w) {
    if (align === 'center') return `:${'-'.repeat(w - 2)}:`;
    if (align === 'right') return `${'-'.repeat(w - 1)}:`;
    if (align === 'left') return `:${'-'.repeat(w - 1)}`;
    return '-'.repeat(w);
}

/** The lines `[first, last]` (indices) of the run of table rows around `line`. */
function blockAround(lines, line) {
    let first = line;
    let last = line;
    while (first > 0 && isRow(lines[first - 1])) first--;
    while (last < lines.length - 1 && isRow(lines[last + 1])) last++;
    return [first, last];
}

/**
 * Lays rows out: `rows[0]` is the header, `rows[1]` the separator (null cells =
 * all default), the rest body rows. Returns the lines and where each cell's
 * content starts, for placing the caret.
 */
function layout(rows, aligns, indent) {
    const cols = aligns.length;
    const body = rows.map((r) => Array.from({ length: cols }, (_, c) => r?.[c] ?? ''));
    const widths = Array.from({ length: cols }, (_, c) =>
        Math.max(3, ...body.filter((_, i) => i !== 1).map((r) => width(r[c]))),
    );
    const lines = body.map((cells, i) => {
        const text =
            i === 1
                ? widths.map((w, c) => separatorCell(aligns[c], w))
                : cells.map((cell, c) => {
                      const pad = ' '.repeat(widths[c] - width(cell));
                      return aligns[c] === 'right' ? pad + cell : cell + pad;
                  });
        return `${indent}| ${text.join(' | ')} |`;
    });
    // Offset of each cell's content within its line.
    const starts = widths.map((_, c) => indent.length + 2 + widths.slice(0, c).reduce((n, w) => n + w + 3, 0));
    return { lines, starts, widths };
}

// Reads the table around `line`: header, separator, body rows. Null when it has
// no separator line yet.
function readTable(lines, line) {
    const [first, last] = blockAround(lines, line);
    if (first === last) return { first, last, header: cellsOf(lines[first]), single: true };
    const second = cellsOf(lines[first + 1]);
    if (!second.every(isSeparatorCell)) return null;
    const header = cellsOf(lines[first]);
    const aligns = header.map((_, c) => alignOf(second[c] ?? ''));
    const rows = [];
    for (let i = first + 2; i <= last; i++) rows.push(cellsOf(lines[i]));
    return { first, last, header, aligns, rows };
}

function lineAt(text, pos) {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
        if (pos <= offset + lines[i].length) return { lines, index: i, offset, col: pos - offset };
        offset += lines[i].length + 1;
    }
    return { lines, index: lines.length - 1, offset, col: 0 };
}

function replaceBlock(text, lines, first, last, newLines, tail = '') {
    let from = 0;
    for (let i = 0; i < first; i++) from += lines[i].length + 1;
    let to = from;
    for (let i = first; i <= last; i++) to += lines[i].length + (i < last ? 1 : 0);
    return { from, to, insert: newLines.join('\n') + tail };
}

/** Enter at the end of a table row. */
export function tableEnter(text, start, end) {
    if (start !== end) return null;
    const { lines, index, col } = lineAt(text, start);
    const line = lines[index];
    if (col !== line.length || !isRow(line)) return null;
    const indent = line.match(/^\s*/)[0];
    const table = readTable(lines, index);
    if (!table) return null;

    let rows;
    let aligns;
    let target; // index in `rows` (header = 0, separator = 1) of the row the caret goes to
    let exit = false;
    if (table.single) {
        aligns = table.header.map(() => '');
        rows = [table.header, null, []];
        target = 2;
    } else {
        aligns = table.aligns;
        const at = index - table.first;
        if (at < 2) return null;
        const body = table.rows;
        const here = body[at - 2];
        rows = [table.header, null, ...body];
        if (here.every((c) => c === '')) {
            // An empty row ends the table, the way an empty list item ends a list.
            rows.splice(at, 1);
            exit = true;
        } else {
            rows.splice(at + 1, 0, []);
            target = at + 1;
        }
    }

    const { lines: out, starts } = layout(rows, aligns, indent);
    const head = replaceBlock(text, lines, table.first, table.last, out, exit ? '\n' : '');
    const caret = exit
        ? head.from + head.insert.length
        : head.from + out.slice(0, target).reduce((n, l) => n + l.length + 1, 0) + starts[0];
    return { ...head, select: [caret, caret] };
}

// Tidies the table the caret is in and moves the caret: `pick({ row, cell, rows, cols })`
// answers with the `{ row, cell }` to land on (row 0 header, 1 separator, 2.. body),
// or null to stay put. A row past the end is added.
function step(text, start, end, pick) {
    if (start !== end) return null;
    const { lines, index, col } = lineAt(text, start);
    const line = lines[index];
    if (!isRow(line)) return null;
    const table = readTable(lines, index);
    if (!table || table.single) return null;
    const indent = line.match(/^\s*/)[0];
    const cols = table.aligns.length;

    // Which cell the caret is in: pipes (not escaped) before it, less the leading one.
    const before = line.slice(0, col);
    const here = Math.min(cols - 1, Math.max(0, before.replace(/\\\|/g, '').split('|').length - 2));

    const rows = [table.header, null, ...table.rows];
    const to = pick({ row: index - table.first, cell: here, rows: rows.length, cols });
    if (!to) return null;
    const { row, cell } = to;
    if (row >= rows.length) rows.push([]);
    const { lines: out, starts } = layout(rows, table.aligns, indent);
    const edit = replaceBlock(text, lines, table.first, table.last, out);
    const base = edit.from + out.slice(0, row).reduce((n, l) => n + l.length + 1, 0);
    const content = rows[row][cell] ?? '';
    const a = base + starts[cell];
    return { ...edit, select: [a, a + (content ? width(content) : 0)] };
}

/** Tab / Shift+Tab inside a table: tidy it and step to the next / previous cell. */
export function tableTab(text, start, end, back = false) {
    return step(text, start, end, ({ row, cell, cols }) => {
        let c = cell + (back ? -1 : 1);
        let r = row;
        if (c >= cols) [c, r] = [0, r + 1];
        else if (c < 0) [c, r] = [cols - 1, r - 1];
        if (r === 1) r = back ? 0 : 2;
        return r < 0 ? null : { row: r, cell: c };
    });
}

/**
 * Alt+Arrows inside a table: left/right to the neighbouring cell (wrapping to the
 * next/previous row), up/down to the same column one row up/down. Nothing is
 * added: at an edge the caret stays.
 */
export function tableMove(text, start, end, dir) {
    return step(text, start, end, ({ row, cell, rows, cols }) => {
        if (dir === 'left' || dir === 'right') {
            const delta = dir === 'right' ? 1 : -1;
            let c = cell + delta;
            let r = row;
            if (c >= cols) [c, r] = [0, r + 1];
            else if (c < 0) [c, r] = [cols - 1, r - 1];
            if (r === 1) r = delta > 0 ? 2 : 0;
            return r < 0 || r >= rows ? null : { row: r, cell: c };
        }
        let r = row + (dir === 'down' ? 1 : -1);
        if (r === 1) r = dir === 'down' ? 2 : 0;
        return r < 0 || r >= rows ? null : { row: r, cell };
    });
}
