// The text edits behind /note's selection toolbar and its shortcuts: bold, a
// list, a quote, an alert. Each takes the note's text and the selection and
// answers with the one replacement to make, never touching a textarea, so every
// rule is tested under node and the editor only has to apply the answer.
//
//   { from, to, insert, select: [start, end] }
//
// replaces text[from, to) with `insert`; `select` is where the selection goes in
// the NEW text.

export const ALERTS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];

const LIST_MARK = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const ALERT_LINE = /^>\s?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

const edit = (from, to, insert, a, b = a) => ({ from, to, insert, select: [a, b] });

/** `[start, end)` of the whole lines a selection touches. */
export function lineRange(text, start, end) {
    const from = text.lastIndexOf('\n', start - 1) + 1;
    // A selection that ends right after a line break does not reach the next line.
    const reach = end > start && text[end - 1] === '\n' ? end - 1 : end;
    let to = text.indexOf('\n', reach);
    if (to < 0) to = text.length;
    return [from, to];
}

/**
 * Wraps the selection in `open`/`close`, or takes them off when they are already
 * there: inside the selection (`**bold**` selected) or just outside it.
 */
export function toggleInline(text, start, end, open, close = open) {
    const selected = text.slice(start, end);
    if (!selected) {
        return edit(start, end, open + close, start + open.length);
    }
    if (
        selected.length >= open.length + close.length &&
        selected.startsWith(open) &&
        selected.endsWith(close)
    ) {
        const inner = selected.slice(open.length, selected.length - close.length);
        return edit(start, end, inner, start, start + inner.length);
    }
    if (text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close) {
        return edit(start - open.length, end + close.length, selected, start - open.length, start - open.length + selected.length);
    }
    return edit(start, end, open + selected + close, start + open.length, start + open.length + selected.length);
}

/** `[selected](url)` with `url` selected, ready to be typed over. */
export function toLink(text, start, end) {
    const selected = text.slice(start, end);
    if (/^https?:\/\/\S+$/.test(selected)) {
        return edit(start, end, `[](${selected})`, start + 1);
    }
    const label = selected || 'text';
    const insert = `[${label}](url)`;
    const urlAt = start + label.length + 3;
    return edit(start, end, insert, urlAt, urlAt + 3);
}

// --- Whole-line edits ---

function blockOf(text, start, end) {
    const [from, to] = lineRange(text, start, end);
    return { from, to, lines: text.slice(from, to).split('\n') };
}

function finish(block, lines) {
    const insert = lines.join('\n');
    return edit(block.from, block.to, insert, block.from, block.from + insert.length);
}

const isBlank = (line) => line.trim() === '';

/** Takes list, task and quote marks off a line, keeping its indent. */
function stripBlockMark(line) {
    return line.replace(/^(\s*)>\s?/, '$1').replace(LIST_MARK, '$1');
}

/** `kind`: 'bullet' | 'ordered' | 'task' | 'quote'. Off again when every line already has it. */
export function toggleLinePrefix(text, start, end, kind) {
    const block = blockOf(text, start, end);
    const has = {
        bullet: (l) => /^\s*[-*+]\s+(?!\[[ xX]\])/.test(l),
        ordered: (l) => /^\s*\d+[.)]\s+/.test(l),
        task: (l) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(l),
        quote: (l) => /^\s*>/.test(l),
    }[kind];
    const filled = block.lines.filter((l) => !isBlank(l));
    const allHave = filled.length > 0 && filled.every(has);

    let n = 0;
    const lines = block.lines.map((line) => {
        if (isBlank(line)) return line;
        const indent = line.match(/^\s*/)[0];
        if (kind === 'quote') {
            return allHave ? line.replace(/^(\s*)>\s?/, '$1') : `${indent}> ${line.slice(indent.length)}`;
        }
        const bare = stripBlockMark(line);
        if (allHave) return bare;
        const body = bare.slice(indent.length);
        if (kind === 'ordered') return `${indent}${++n}. ${body}`;
        return `${indent}${kind === 'task' ? '- [ ] ' : '- '}${body}`;
    });
    return finish(block, lines);
}

/** Heading level of the first line, one deeper (1, 2, 3), then none. */
export function cycleHeading(text, start, end, max = 3) {
    const block = blockOf(text, start, end);
    const first = block.lines.find((l) => !isBlank(l)) ?? '';
    const level = (first.match(/^(#{1,6})\s/) || ['', ''])[1].length;
    const next = level >= max || level === 6 ? 0 : level + 1;
    const lines = block.lines.map((line) => {
        if (isBlank(line)) return line;
        const bare = line.replace(/^#{1,6}\s+/, '');
        return next ? `${'#'.repeat(next)} ${bare}` : bare;
    });
    return finish(block, lines);
}

/** The selected lines inside a fenced code block, or out of one. */
export function toggleFence(text, start, end) {
    const block = blockOf(text, start, end);
    const { lines } = block;
    const fenced =
        lines.length >= 2 && /^```/.test(lines[0]) && /^```\s*$/.test(lines[lines.length - 1]);
    return finish(block, fenced ? lines.slice(1, -1) : ['```', ...lines, '```']);
}

/** The selected lines as a GitHub alert; an alert already there becomes the next kind. */
export function toggleAlert(text, start, end, kind = 'NOTE') {
    const block = blockOf(text, start, end);
    const { lines } = block;
    const marker = lines[0].match(ALERT_LINE);
    if (marker) {
        const next = ALERTS[(ALERTS.indexOf(marker[1].toUpperCase()) + 1) % ALERTS.length];
        return finish(block, [`> [!${next}]`, ...lines.slice(1)]);
    }
    const quoted = lines.map((line) => (isBlank(line) ? '>' : `> ${line}`));
    return finish(block, [`> [!${kind}]`, ...quoted]);
}

/**
 * Inline marks, headings, list/task/quote marks and links off the selected lines.
 * Code is left alone: a fence line, and what is inside a fenced block (whether
 * the block's opening fence is in the selection or above it).
 */
export function clearFormatting(text, start, end) {
    const block = blockOf(text, start, end);
    // Inside a fence already when the selection begins? Count the fences above.
    const above = text.slice(0, block.from).split('\n').filter((l) => /^```/.test(l)).length;
    let fenced = above % 2 === 1;
    const lines = block.lines.map((line) => {
        if (/^```/.test(line)) {
            fenced = !fenced;
            return line;
        }
        if (fenced) return line;
        return stripBlockMark(line.replace(/^(\s*)#{1,6}\s+/, '$1'))
            .replace(/\[([^\]\n]+)\]\((?:https?:\/\/[^\s)]+)\)/g, '$1')
            .replace(/(\*\*|__|~~|==)([^\n]+?)\1/g, '$2')
            .replace(/`([^`\n]+)`/g, '$1')
            .replace(/(^|[^*\w])\*([^*\s][^*\n]*)\*(?!\w)/g, '$1$2')
            .replace(/(^|[^_\w])_([^_\s][^_\n]*)_(?!\w)/g, '$1$2');
    });
    return finish(block, lines);
}
