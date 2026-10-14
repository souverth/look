// "Go to" in /note: the things in a note you can jump to (headings, tasks, code
// blocks, tables, images, alerts) and how a query picks among them. Pure, so what
// counts as what (not a `#` inside a code block) is tested under node.
//
//   18          -> line 18
//   :18         -> line 18
//   intro       -> anything whose title has "intro" (headings, if nothing is typed)
//   h2          -> the level 2 headings        h  heading  title -> all headings
//   task  todo  -> unfinished and finished tasks     done -> finished ones
//   code  table  img  alert -> that kind, then the rest of the query narrows it

import { findCommentBlocks } from '../../markdown.js';

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s+(.*)$/;
const IMAGE = /!\[([^\]\n]*)\]\(([^)\s\n]*)/g;
const ALERT = /^>\s?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;
const COMMENT = /^\s*<!--(.*?)-->\s*$/;
const IMAGE_WHOLE = /!\[[^\]\n]*\]\([^)\n]*\)/g;
// [text](https://...) or a bare https://... address
const LINK = /\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL = /https?:\/\/[^\s)<>]+/g;
// #tag, the way the notes list reads it: after a space or at the start, ending at a space or the end
const TAG = /(^|\s)#([\p{L}\p{N}_-]{1,24})(?=\s|$)/gu;
const ROW = /^\s*\|.*\|\s*$/;
const SEPARATOR = /^\s*\|[\s:|-]+\|\s*$/;

/**
 * Every place worth jumping to, in order: `{ line, kind, title, level?, done? }`
 * (`line` counts from 0). `kind` is `heading`, `task`, `code`, `table`, `image`,
 * `link`, `tag`, `quote`, `alert` or `comment`. Nothing inside a fenced code block is
 * read as anything but the block. A line has at most one structural kind (heading,
 * task, table row, quote...) and may add images, links and tags found in its text.
 */
export function landmarks(text) {
    const found = [];
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    let inQuote = false;
    // A comment over several lines is one landmark, and what is inside it is not read.
    const comments = new Map(findCommentBlocks(lines).map((b) => [b.start, b.end]));
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (comments.has(i)) {
            const inner = lines.slice(i, comments.get(i) + 1).join(' ').replace(/<!--|-->/g, '').trim();
            found.push({ line: i, kind: 'comment', title: inner.slice(0, 60) || 'comment' });
            i = comments.get(i);
            inQuote = false;
            continue;
        }
        const fence = line.match(/^\s*```+\s*([\w+#.-]*)/);
        if (fence) {
            // The whole block is one landmark, titled by its language and first line.
            let end = i + 1;
            while (end < lines.length && !/^\s*```/.test(lines[end])) end++;
            const first = lines.slice(i + 1, end).find((l) => l.trim()) ?? '';
            const lang = fence[1];
            found.push({ line: i, kind: 'code', title: [lang || 'code', first.trim().slice(0, 48)].filter(Boolean).join('  ') });
            i = end;
            inQuote = false;
            continue;
        }

        let body = line; // what is left to look through for images, links and tags
        const heading = line.match(HEADING);
        const task = line.match(TASK);
        const alert = line.match(ALERT);
        const comment = line.match(COMMENT);
        const isQuote = !alert && /^\s*>/.test(line);
        if (heading && heading[2]) {
            found.push({ line: i, kind: 'heading', level: heading[1].length, title: heading[2] });
            body = heading[2];
        } else if (task) {
            found.push({ line: i, kind: 'task', done: task[1] !== ' ', title: task[2] });
            body = task[2];
        } else if (ROW.test(line) && SEPARATOR.test(lines[i + 1] ?? '')) {
            const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim()).filter(Boolean);
            found.push({ line: i, kind: 'table', title: cells.join(' | ') || 'table' });
            // The rows belong to it.
            while (i + 1 < lines.length && ROW.test(lines[i + 1])) i++;
            continue;
        } else if (alert) {
            found.push({ line: i, kind: 'alert', title: [alert[1][0] + alert[1].slice(1).toLowerCase(), alert[2]].filter(Boolean).join('  ') });
            body = alert[2];
        } else if (comment) {
            found.push({ line: i, kind: 'comment', title: comment[1].trim() || 'comment' });
            continue;
        } else if (isQuote) {
            // A run of quoted lines is one quote, found at its first line.
            const quoted = line.replace(/^\s*(?:>\s?)+/, '');
            if (!inQuote) found.push({ line: i, kind: 'quote', title: quoted.trim() || 'quote' });
            body = quoted;
        }
        inQuote = isQuote;
        inline(body, i, found);
    }
    return found;
}

// Images, links and #tags in a piece of text.
function inline(text, line, found) {
    IMAGE.lastIndex = 0;
    for (let m = IMAGE.exec(text); m; m = IMAGE.exec(text)) {
        const name = m[1].replace(/\|\d+(?:%|px)?(?:x\d+)?$/, '') || m[2].split(/[\\/]/).pop() || 'image';
        found.push({ line, kind: 'image', title: name });
    }
    // Links are looked for in what is left once the images are taken out.
    let rest = text.replace(IMAGE_WHOLE, ' ').replace(/`[^`]*`/g, ' ');
    // [text](url) first, taken out of the text so its address is not found again as a bare one.
    LINK.lastIndex = 0;
    for (let m = LINK.exec(rest); m; m = LINK.exec(rest)) {
        found.push({ line, kind: 'link', title: m[1] || m[2] });
    }
    rest = rest.replace(LINK, ' ');
    BARE_URL.lastIndex = 0;
    for (let m = BARE_URL.exec(rest); m; m = BARE_URL.exec(rest)) {
        found.push({ line, kind: 'link', title: m[0] });
    }
    // An address has no tags in it (https://x.io/#top is not #top).
    rest = rest.replace(BARE_URL, ' ');
    TAG.lastIndex = 0;
    for (let m = TAG.exec(rest); m; m = TAG.exec(rest)) {
        found.push({ line, kind: 'tag', title: `#${m[2]}` });
    }
}

/** The headings alone, as `{ line, level, title }`. */
export function outline(text) {
    return landmarks(text)
        .filter((l) => l.kind === 'heading')
        .map(({ line, level, title }) => ({ line, level, title }));
}

// What a first word can mean, in the order tried. A word counts when it is one of a
// kind's names or (from two letters) the start of exactly one of them.
const KIND_WORDS = [
    ['heading', ['heading', 'headings', 'title', 'titles', 'h']],
    ['task', ['task', 'tasks', 'todo', 'todos', 'checkbox']],
    ['done', ['done', 'finished', 'checked']],
    ['code', ['code', 'codeblock', 'snippet']],
    ['table', ['table', 'tables']],
    ['image', ['image', 'images', 'img', 'picture', 'pic', 'photo']],
    ['alert', ['alert', 'alerts', 'callout']],
    ['link', ['link', 'links', 'url', 'urls', 'href']],
    ['tag', ['tag', 'tags', 'hashtag']],
    ['quote', ['quote', 'quotes', 'blockquote']],
    ['comment', ['comment', 'comments']],
];

/** `{ kind, level, rest }`: the kind a leading word names (null for none) and what is left. */
export function readKind(query) {
    const q = query.trim().replace(/^:/, '');
    const [word = '', ...others] = q.split(/\s+/);
    const rest = others.join(' ');
    const w = word.toLowerCase();
    const level = w.match(/^h([1-6])$/);
    if (level) return { kind: 'heading', level: Number(level[1]), rest };
    if (!w) return { kind: null, level: 0, rest: '' };
    const exact = KIND_WORDS.find(([, words]) => words.includes(w));
    if (exact) return { kind: exact[0], level: 0, rest };
    if (w.length >= 2) {
        const starts = KIND_WORDS.filter(([, words]) => words.some((x) => x.startsWith(w)));
        if (starts.length === 1) return { kind: starts[0][0], level: 0, rest };
    }
    return { kind: null, level: 0, rest: q };
}

/**
 * What a query asks for: `{ line }` for a number, otherwise `{ items }` that match.
 * `items` are `landmarks` (or just headings: an item without a kind is one).
 */
export function readJump(query, items, lineCount) {
    const q = query.trim().replace(/^:/, '');
    if (/^\d+$/.test(q)) {
        // A line number, held to the lines there are: 0 is the first, 9999 the last.
        const n = Math.min(Math.max(1, Number(q)), Math.max(1, lineCount));
        return { line: n - 1 };
    }
    const { kind, level, rest } = readKind(query);
    const needle = rest.toLowerCase();
    const kindOf = (item) => item.kind ?? 'heading';
    let pool;
    if (kind === 'task') pool = items.filter((i) => kindOf(i) === 'task');
    else if (kind === 'done') pool = items.filter((i) => kindOf(i) === 'task' && i.done);
    else if (kind) pool = items.filter((i) => kindOf(i) === kind && (!level || i.level === level));
    // No kind: headings when nothing is typed, otherwise a search over everything.
    else pool = needle ? items : items.filter((i) => kindOf(i) === 'heading');
    const matches = needle ? pool.filter((i) => i.title.toLowerCase().includes(needle)) : [...pool];
    const starts = (i) => (needle && i.title.toLowerCase().startsWith(needle) ? 1 : 0);
    matches.sort((a, b) => starts(b) - starts(a) || a.line - b.line);
    // `headings` is the old name for the same list.
    return { items: matches, headings: matches };
}

/** The offset of the start of `line` (from 0) in `text`. */
export function offsetOfLine(text, line) {
    let at = 0;
    for (let i = 0; i < line; i++) {
        const next = text.indexOf('\n', at);
        if (next < 0) return text.length;
        at = next + 1;
    }
    return at;
}
