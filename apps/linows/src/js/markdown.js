// Small Markdown renderer for the /note preview. Not a full CommonMark
// implementation: it covers what quick notes use (headings, emphasis, inline
// code, fenced code, quotes, bullet/numbered/task lists, rules, links). Every
// piece of user text is HTML-escaped before any markup is added, so the output
// is safe to assign to innerHTML.

import { alertCircle, info, lightbulb, messageWarning, triangleAlert } from './icons.js';

// GitHub's five alert kinds: `> [!NOTE]` on the first line of a quote makes it a
// callout with a coloured edge, an icon and a title.
const ALERT_KINDS = {
    note: { label: 'Note', icon: info },
    tip: { label: 'Tip', icon: lightbulb },
    important: { label: 'Important', icon: messageWarning },
    warning: { label: 'Warning', icon: triangleAlert },
    caution: { label: 'Caution', icon: alertCircle },
};

export function escapeHtml(s) {
    return String(s).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
}

// Links are shown but not followed (the webview has nowhere to send them), so
// only the label is rendered, link-styled; the URL rides in `title`.
function inline(text) {
    const codes = [];
    let out = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
        codes.push(code);
        return `\u0000${codes.length - 1}\u0000`;
    });
    // Images first, as tokens: the emphasis and link rules below must not reach
    // into a URL (`my_image_name.png`) or an alt text.
    const pictures = [];
    out = out.replace(IMAGE_ESCAPED, (_, alt, src) => {
        pictures.push(imageHtml(alt, src));
        return `\u0001${pictures.length - 1}\u0001`;
    });
    out = out
        .replace(
            /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
            '<span class="md-link" title="$2">$1</span>',
        )
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>')
        .replace(/==([^=]+)==/g, '<mark>$1</mark>');
    // A few inline HTML tags are drawn as written. Only a matched pair, with no
    // attributes, is let through: a lone <u> or <b> would otherwise run on into
    // the paragraphs after it.
    out = out.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    for (let pass = 0; pass < 2; pass++) {
        out = out.replace(HTML_PAIR, (_, tag, body) => `<${tag.toLowerCase()}>${body}</${tag.toLowerCase()}>`);
    }
    // Tags with an attribute are rebuilt, never passed through: a link is only
    // shown (like [text](url)), an abbreviation keeps its title, an image shows
    // its alt text. Quotes arrive escaped, so the values are already safe.
    out = out
        .replace(ATTR_A, (_, __, url, body) => linkSpan(url, body))
        .replace(ATTR_ABBR, (_, __, title, body) => `<abbr title="${title}">${body}</abbr>`)
        .replace(ATTR_IMG, (_, attrs) => {
            const src = (attrs.match(/src=(&quot;|&#39;)(.*?)\1/i) || [])[2] || '';
            const alt = (attrs.match(/alt=(&quot;|&#39;)(.*?)\1/i) || [])[2] || 'image';
            return linkSpan(src, alt);
        });
    out = out.replace(/\u0001(\d+)\u0001/g, (_, i) => pictures[Number(i)]);
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

// --- Images: ![alt](src), with a width in the alt text as ![alt|300](src) ---
//
// The width is 300, 300px, 50% or 300x200, after a `|` at the end of the alt (the
// way Obsidian writes it). Remote (http, https), inline (data:image) and local
// files are drawn; anything else is shown as its alt text. In the preview each
// image has a handle to drag; `withImageWidth` writes the new width back.

const IMAGE_ESCAPED = /!\[([^\]\n]*)\]\(([^)\s\n]*)(?:\s+&quot;.*?&quot;)?\)/g;
const IMAGE_SOURCE = /!\[([^\]\n]*)\]\(([^)\s\n]*)(?:\s+"[^"\n]*")?\)/g;
const SIZE = /\|(\d+)(%|px)?(?:x(\d+))?$/;

let pictureCount = 0; // nth image of the note being rendered, to find it again in the text

// The alt text and the size that rides in it.
export function splitImageAlt(alt) {
    const m = alt.match(SIZE);
    if (!m) return { alt, width: '', height: '' };
    return { alt: alt.slice(0, m.index), width: m[1] + (m[2] || 'px'), height: m[3] ? `${m[3]}px` : '' };
}

function imageHtml(rawAlt, src) {
    const index = pictureCount++;
    const { alt, width, height } = splitImageAlt(rawAlt);
    const plain = src.replace(/&amp;/g, '&');
    let where = '';
    if (/^https?:\/\//i.test(plain) || /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,/i.test(plain)) {
        where = ` src="${src}"`;
    } else if (/^file:\/\//i.test(plain) || /^[a-z]:[\\/]/i.test(plain) || /^\/(?!\/)/.test(plain)) {
        // A file on this machine: the preview turns the path into an address the
        // webview may load (see resolveLocalImages in note.js).
        let path = plain.replace(/^file:\/\//i, '').replace(/^\/([a-z]:)/i, '$1');
        try {
            path = decodeURI(path);
        } catch {
            // not percent-encoded: use it as written
        }
        where = ` data-local="${escapeHtml(path)}"`;
    } else {
        return `<span class="md-img-missing" title="${src}">${alt || src || 'image'}</span>`;
    }
    const size = width ? ` style="width:${width}"` : '';
    const tall = height ? ` style="height:${height}"` : '';
    return (
        `<span class="md-imgbox" data-img="${index}"${size} data-alt="${alt}">` +
        `<img class="md-img" alt="${alt}"${where}${tall} loading="lazy" decoding="async" draggable="false">` +
        `<span class="md-img-handle" title="Drag to resize, double-click for the original size"></span></span>`
    );
}

/**
 * Every image in `source`, in the order the preview draws them, skipping fenced
 * code, inline code and one-line comments: `{ start, length, alt, src }`, where
 * `start`/`length` locate the alt text (and its size) inside the note.
 */
export function findImages(source) {
    const found = [];
    let offset = 0;
    let fenced = false;
    for (const line of String(source).split('\n')) {
        const here = offset;
        offset += line.length + 1;
        if (/^```/.test(line)) {
            fenced = !fenced;
            continue;
        }
        if (fenced || /^\s*<!--.*-->\s*$/.test(line)) continue;
        // Inline code is blanked out, same width, so an image shown inside it is not counted.
        const masked = line.replace(/`[^`]+`/g, (m) => ' '.repeat(m.length));
        IMAGE_SOURCE.lastIndex = 0;
        for (let m = IMAGE_SOURCE.exec(masked); m; m = IMAGE_SOURCE.exec(masked)) {
            found.push({ start: here + m.index + 2, length: m[1].length, alt: m[1], src: m[2] });
        }
    }
    return found;
}

/** `source` with image number `index` given `width` (a number of pixels, or null to drop it). */
export function withImageWidth(source, index, width) {
    const target = findImages(source)[index];
    if (!target) return null;
    const alt = splitImageAlt(target.alt);
    // Keep a height only when the image had none to begin with: a width alone lets it follow.
    const next = width ? `${alt.alt}|${width}` : alt.alt;
    return source.slice(0, target.start) + next + source.slice(target.start + target.length);
}

const HTML_PAIR = /&lt;(mark|kbd|u|sub|sup|ins|del|s|small|abbr|b|i|em|strong|q|cite|dfn|var|samp|time)&gt;(.*?)&lt;\/\1&gt;/gi;
const ATTR_A = /&lt;a\s+href=(&quot;|&#39;)(.*?)\1\s*&gt;(.*?)&lt;\/a&gt;/gi;
const ATTR_ABBR = /&lt;abbr\s+title=(&quot;|&#39;)(.*?)\1\s*&gt;(.*?)&lt;\/abbr&gt;/gi;
const ATTR_IMG = /&lt;img\s+(.*?)\s*\/?&gt;/gi;

// A link is drawn but not followed; only http(s) addresses are kept as its tooltip.
function linkSpan(url, body) {
    const shown = /^https?:\/\//i.test(url) ? ` title="${url}"` : '';
    return `<span class="md-link"${shown}>${body || url}</span>`;
}

// | a | b |
// | - | - |   -> a table. Cells may hold the same inline markup as a paragraph.
const TABLE_ROW = /^\s*\|.*\|\s*$/;
// Cells of one table row; a pipe escaped as \| stays inside its cell.
export function splitRow(line) {
    const cells = [];
    for (const part of line.trim().slice(1, -1).split('|')) {
        if (cells.length && cells[cells.length - 1].endsWith('\\')) cells[cells.length - 1] += `|${part}`;
        else cells.push(part);
    }
    return cells.map((c) => c.trim());
}

function tableHtml(rows) {
    const [head, sep, ...body] = rows.map(splitRow);
    const align = sep.map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '',
    );
    const cell = (tag, text, c) => {
        const style = align[c] ? ` style="text-align:${align[c]}"` : '';
        return `<${tag}${style}>${inline(text.replace(/\\\|/g, '|'))}</${tag}>`;
    };
    const tr = (cells, tag) => `<tr>${head.map((_, c) => cell(tag, cells[c] ?? '', c)).join('')}</tr>`;
    return (
        `<div class="md-table"><table><thead>${tr(head, 'th')}</thead>` +
        `<tbody>${body.map((r) => tr(r, 'td')).join('')}</tbody></table></div>`
    );
}

// What follows the opening ``` : a language, and optionally the file the code
// comes from. Accepted forms (the path is shown only when the author gives one):
//   ```ts                      language only
//   ```ts:src/app.ts           language:path
//   ```ts title="src/app.ts"   title= / file= / filename= / path=
//   ```ts src/app.ts           language then a bare path
//   ```src/app.ts              a path alone (language comes from its extension)
export function parseFenceInfo(info) {
    // line=N (or start= / startLine=) asks for line numbers counting from N; it
    // is taken out first so what is left reads as language and path.
    let line;
    const text = info
        .replace(/(?:^|\s)(?:line|start|startline)\s*=\s*(\d+)(?=\s|$)/i, (_, n) => {
            line = Number(n);
            return ' ';
        })
        .trim();
    const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, '$2');
    let lang = (text.match(/^[\w+#.\/\\-]*/) || [''])[0];
    let rest = text.slice(lang.length).trim();
    let path = '';

    if (/^[a-z]:[\\\/]/i.test(text)) {
        // A Windows drive path: its colon is not the language:path separator.
        path = unquote(text);
        lang = (path.match(/\.(\w+)$/) || [, ''])[1];
    } else if (/[\/\\]/.test(lang) || /\.\w+$/.test(lang)) {
        // The first word is itself a path.
        path = lang;
        lang = (lang.match(/\.(\w+)$/) || [, ''])[1];
    } else if (rest.startsWith(':')) {
        path = unquote(rest.slice(1));
    } else {
        const attr = rest.match(/(?:title|file|filename|path)\s*=\s*("[^"]*"|'[^']*'|\S+)/i);
        if (attr) path = unquote(attr[1]);
        else if (rest && !rest.includes('=')) path = unquote(rest);
    }
    if (!lang && path) lang = (path.match(/\.(\w+)$/) || [, ''])[1];
    const parsed = { lang: lang.toLowerCase(), path: path.trim().slice(0, 200) };
    if (line !== undefined) parsed.line = line;
    return parsed;
}

// A code block: header (file path with the name emphasised, or just the
// language) with a Copy button, then the code. The code is highlighted after
// rendering (see highlightCodeBlocks in note.js); until then, and for unknown
// languages, it is plain escaped text.
function codeBlock(code, { lang, path, line }) {
    let title = '';
    if (path) {
        const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
        title = `<span class="md-code-file" title="${escapeHtml(path)}"><span class="md-code-dir">${escapeHtml(path.slice(0, cut))}</span><b>${escapeHtml(path.slice(cut))}</b></span>`;
    }
    const label = lang ? `<span class="md-code-lang">${escapeHtml(lang)}</span>` : '';
    // Numbers sit in a column beside the code, so highlighting the code (which
    // rewrites its innerHTML) cannot disturb them.
    let nums = '';
    if (line !== undefined) {
        const count = code.split('\n').length;
        const list = Array.from({ length: count }, (_, i) => line + i).join('\n');
        nums = `<pre class="md-code-nums" aria-hidden="true">${list}</pre>`;
    }
    return (
        `<div class="md-code"><div class="md-code-head">${title || '<span class="md-code-file"></span>'}${label}` +
        `<button type="button" class="md-copy" title="Copy code">Copy</button></div>` +
        `<div class="md-code-body">${nums}<pre><code data-lang="${escapeHtml(lang)}">${escapeHtml(code)}</code></pre></div></div>`
    );
}

// How a number is written at each level, as word processors do: 1. a. i. A. I. and
// round again. Level 0 keeps plain digits so a note reads the same in any viewer.
function ordinal(depth, n) {
    const style = depth % 5;
    if (style === 0) return String(n);
    if (style === 1 || style === 3) {
        let s = '';
        for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
        return style === 3 ? s.toUpperCase() : s;
    }
    const romans = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let s = '';
    for (const [value, glyph] of romans) while (n >= value) { s += glyph; n -= value; }
    return style === 4 ? s.toUpperCase() : s;
}

const LIST_RE =/^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

// `offset` is the source line the text starts on, so task items can carry the
// line they came from (data-line) and the preview can tick them in the source.
/**
 * The comments that run over several lines: `<!--` ending a line (or opening it with
 * more after) and a later line holding the `-->`. `{ start, end }` in lines, from 0.
 * One that never closes is not a comment (it would swallow the rest of the note), and
 * nothing inside a fenced code block counts.
 */
export function findCommentBlocks(lines) {
    const blocks = [];
    let fenced = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*```/.test(line)) {
            fenced = !fenced;
            continue;
        }
        if (fenced) continue;
        const open = line.indexOf('<!--');
        if (open < 0 || line.indexOf('-->', open + 4) >= 0) continue;
        let end = -1;
        for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].includes('-->')) {
                end = j;
                break;
            }
        }
        if (end < 0) continue;
        blocks.push({ start: i, end });
        i = end;
    }
    return blocks;
}

let renderDepth = 0;

export function renderMarkdown(src, offset = 0) {
    // Quotes, alerts and folds render their insides through here too; only the
    // outermost call starts the image count over.
    if (renderDepth === 0) pictureCount = 0;
    renderDepth++;
    try {
        return renderBlocks(src, offset);
    } finally {
        renderDepth--;
    }
}

function renderBlocks(src, offset) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    // Where a comment over several lines starts, and the line it ends on.
    const commentEnds = new Map(findCommentBlocks(lines).map((b) => [b.start, b.end]));
    const html = [];
    let i = 0;
    let para = [];

    const flushPara = () => {
        if (para.length) html.push(`<p>${para.map(inline).join('<br>')}</p>`);
        para = [];
    };

    while (i < lines.length) {
        const line = lines[i];

        const fence = line.match(/^```([^`]*)$/);
        if (fence) {
            flushPara();
            const code = [];
            i++;
            while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
            i++; // closing fence (or EOF)
            html.push(codeBlock(code.join('\n'), parseFenceInfo(fence[1])));
            continue;
        }

        if (/^\s*$/.test(line)) {
            flushPara();
            i++;
            continue;
        }

        // <details><summary>Title</summary> ... </details>: a fold that opens in the
        // preview. The inside is Markdown like any other.
        if (/^\s*<details(\s+open)?\s*>\s*$/i.test(line)) {
            flushPara();
            const open = /open/i.test(line);
            let j = i + 1;
            while (j < lines.length && !/^\s*<\/details>\s*$/i.test(lines[j])) j++;
            let inner = lines.slice(i + 1, j);
            let summary = 'Details';
            const sm = inner.length && inner[0].match(/^\s*<summary>(.*?)<\/summary>\s*$/i);
            if (sm) {
                summary = sm[1];
                inner = inner.slice(1);
            }
            html.push(
                `<details class="md-details"${open ? ' open' : ''}><summary>${inline(summary)}</summary>` +
                    `<div class="md-details-body">${renderMarkdown(inner.join('\n'), offset + i + 1)}</div></details>`,
            );
            i = j + 1;
            continue;
        }

        // Lines that only open or close a layout tag add nothing to the preview.
        if (/^\s*<\/?(?:div|p|center|section|article|aside|header|footer|main|nav|span)(\s[^<>]*)?>\s*$/i.test(line)) {
            i++;
            continue;
        }

        // A comment over several lines is for the writer too: the preview leaves it all out.
        if (commentEnds.has(i)) {
            flushPara();
            i = commentEnds.get(i) + 1;
            continue;
        }

        // A one-line <!-- comment --> is for the writer: the preview leaves it out.
        if (/^\s*<!--.*-->\s*$/.test(line)) {
            flushPara();
            i++;
            continue;
        }

        // A table: a row, a separator row under it, then rows while they last.
        if (
            TABLE_ROW.test(line) &&
            i + 1 < lines.length &&
            TABLE_ROW.test(lines[i + 1]) &&
            splitRow(lines[i + 1]).every((c) => /^:?-+:?$/.test(c))
        ) {
            flushPara();
            const rows = [lines[i], lines[i + 1]];
            i += 2;
            while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(lines[i++]);
            html.push(tableHtml(rows));
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flushPara();
            const n = heading[1].length;
            html.push(`<h${n}>${inline(heading[2])}</h${n}>`);
            i++;
            continue;
        }

        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
            flushPara();
            html.push('<hr>');
            i++;
            continue;
        }

        if (/^>\s?/.test(line)) {
            flushPara();
            const quote = [];
            const quoteStart = i;
            while (i < lines.length && /^>\s?/.test(lines[i])) {
                quote.push(lines[i++].replace(/^>\s?/, ''));
            }
            const alert = quote[0].match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i);
            if (alert) {
                const kind = alert[1].toLowerCase();
                const { label, icon } = ALERT_KINDS[kind];
                // The body starts one line down, so a task in it still points at
                // its own source line.
                const body = renderMarkdown(quote.slice(1).join('\n'), offset + quoteStart + 1);
                html.push(
                    `<div class="md-alert md-alert-${kind}"><div class="md-alert-title">${icon}<span>${label}</span></div>` +
                        `<div class="md-alert-body">${body}</div></div>`,
                );
                continue;
            }
            html.push(`<blockquote>${renderMarkdown(quote.join('\n'), offset + quoteStart)}</blockquote>`);
            continue;
        }

        const first = line.match(LIST_RE);
        if (first) {
            flushPara();
            const ordered = /\d/.test(first[2]);
            const items = [];
            // Numbers count per level and start again under each parent: 1. 2. then,
            // inside 2., 1. 2. again.
            const counts = [0, 0, 0, 0, 0, 0];
            while (i < lines.length) {
                const m = lines[i].match(LIST_RE);
                if (!m || /\d/.test(m[2]) !== ordered) break;
                const task = m[3].match(/^\[( |x|X)\]\s+(.*)$/);
                const depth = Math.min(5, Math.floor(m[1].replace(/\t/g, '    ').length / 2));
                const done = task && task[1] !== ' ';
                counts[depth]++;
                counts.fill(0, depth + 1);
                const body = task
                    ? `<span class="md-check" role="checkbox" aria-checked="${done}"></span><span class="md-task-text">${inline(task[2])}</span>`
                    : inline(m[3]);
                const cls = `md-d${depth}${task ? ' md-task' : ''}${done ? ' md-done' : ''}`;
                items.push(
                    `<li class="${cls}"${task ? ` data-line="${offset + i}"` : ''} data-n="${ordinal(depth, counts[depth])}">${body}</li>`,
                );
                i++;
            }
            const tag = ordered ? 'ol' : 'ul';
            html.push(`<${tag}>${items.join('')}</${tag}>`);
            continue;
        }

        para.push(line);
        i++;
    }
    flushPara();
    return html.join('');
}
