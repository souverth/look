// Colours Markdown while you type in /note. The editor is a plain textarea with
// its text made transparent and this drawn underneath, so the one rule here is
// that nothing may change what the eye sees *where*: each line comes back as
// HTML whose text is exactly the source line, only wrapped in coloured spans.
// (Colour and underline only: a bold or italic face could shift the caret.)
//
// One call gives one HTML string per source line, so the editor can lay them out
// as blocks, read how tall each wrapped line is, and number the gutter to match.
// Pure, so the invariant is tested under node.

import { escapeHtml, findCommentBlocks } from '../../markdown.js';
import { TAGS } from './note-tags.js';
import { languageId } from './note-code-assist.js';
import { createCodeHighlighter } from './note-code-tokens.js';

const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

const span = (cls, text) => `<span class="${cls}">${escapeHtml(text)}</span>`;

// Inline spans, left to right; the number is the capture group each one fills.
// The italics look at the character before them in code rather than with a
// lookbehind, which older webviews lack.
const INLINE = new RegExp(
    [
        '(`[^`\\n]+`)', //                                       1: inline code
        '(\\*\\*[^*\\n]+\\*\\*)', //                             2: bold
        '(__[^_\\n]+__)', //                                     3: bold
        '(~~[^~\\n]+~~)', //                                     4: strike
        '(==[^=\\n]+==)', //                                     5: highlight
        '(\\[[^\\]\\n]+\\])(\\(https?:\\/\\/[^\\s)]+\\))', //    6, 7: link text, url
        '(\\*[^*\\s][^*\\n]*\\*)(?!\\w)', //                     8: italic
        '(_[^_\\s][^_\\n]*_)(?!\\w)', //                         9: italic
        '(<\\/?[a-z][a-z0-9]*(?:\\s[^<>\\n]*)?>)', //            10: an HTML tag
        '(\\*{1,3}|_{2,3}|~~|==)', //                            11: a mark with nothing to close it
        '(!\\[[^\\]\\n]*\\])(\\([^)\\s\\n]*(?:\\s+"[^"\\n]*")?\\))', //   12, 13: an image, its alt (and size) and its source
    ].join('|'),
    'g',
);

/** One line of ordinary text, spans for the inline marks. */
export function inlineHtml(text) {
    let out = '';
    let last = 0;
    INLINE.lastIndex = 0;
    for (let m = INLINE.exec(text); m; m = INLINE.exec(text)) {
        const [whole] = m;
        const from = m.index;
        // The single-star and single-underscore italics must not start inside a
        // word (snake_case, 2*3*4): look at what comes before.
        // Only tags the editor knows are coloured; `<script>` is just text.
        if (m[10] && !TAGS.includes(m[10].match(/^<\/?([a-z][a-z0-9]*)/i)[1].toLowerCase())) {
            INLINE.lastIndex = from + 1;
            continue;
        }
        // A lone `*`, `**`, `~~`... is coloured as the mark it will become, but
        // not the `*` of 2*3 or the `__` inside snake__case.
        if (m[11] && (/\w/.test(text[from - 1] ?? '') && /\w/.test(text[from + whole.length] ?? ''))) {
            INLINE.lastIndex = from + 1;
            continue;
        }
        if ((m[8] || m[9]) && from > 0 && /[\w*_]/.test(text[from - 1])) {
            INLINE.lastIndex = from + 1;
            continue;
        }
        out += escapeHtml(text.slice(last, from));
        let html;
        if (m[1]) html = span('tok-code', whole);
        else if (m[2] || m[3]) html = span('tok-bold', whole);
        else if (m[4]) html = span('tok-strike', whole);
        else if (m[5]) html = span('tok-mark', whole);
        else if (m[6]) html = span('tok-link', m[6]) + span('tok-url', m[7]);
        else if (m[12]) html = span('tok-img', m[12]) + span('tok-url', m[13]);
        else if (m[10]) html = span('tok-tag', whole);
        else if (m[11]) html = span('tok-marker', whole);
        else html = span('tok-italic', whole);
        out += html;
        last = from + whole.length;
        INLINE.lastIndex = last;
    }
    return out + escapeHtml(text.slice(last));
}

/**
 * `source` -> one HTML string per line (`source.split('\n')`), the last of which
 * is the empty line after a trailing newline, as in the textarea.
 */
export function highlightLines(source) {
    const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
    // Lines inside a comment over several lines are all comment.
    const commented = new Set();
    for (const { start, end } of findCommentBlocks(lines)) for (let k = start; k <= end; k++) commented.add(k);
    let fenced = false;
    let code = null; // colours the lines of the open block
    return lines.map((line, index) => {
        // An empty line stays '' (not an empty span): the view gives '' a row to
        // stand on, and an empty span would collapse to no height at all.
        if (line === '') return '';
        if (commented.has(index)) return span('tok-quote', line);
        if (fenced) {
            if (/^```\s*$/.test(line)) {
                fenced = false;
                return span('tok-fence', line);
            }
            return code.line(line);
        }

        const fence = line.match(/^(```)(.*)$/);
        if (fence) {
            fenced = true;
            code = createCodeHighlighter(languageId(fence[2].trim().split(/[\s:]/)[0]));
            return span('tok-fence', fence[1]) + span('tok-info', fence[2]);
        }

        if (/^\s*<!--.*-->\s*$/.test(line)) return span('tok-quote', line);

        const heading = line.match(/^(#{1,6})(?:(\s+)(.*))?$/);
        if (heading) {
            // Every level has its own colour (tok-h1 .. tok-h6), marker and text alike.
            const level = `tok-h${heading[1].length}`;
            // A bare "##" is already a heading marker, so it colors before the space.
            if (heading[2] === undefined) return span(`tok-marker ${level}`, heading[1]);
            return (
                span(`tok-marker ${level}`, heading[1]) +
                escapeHtml(heading[2]) +
                `<span class="tok-heading ${level}">${inlineHtml(heading[3])}</span>`
            );
        }

        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return span('tok-hr', line);

        const quote = line.match(/^(\s*(?:>\s?)+)(.*)$/);
        if (quote) {
            const alert = quote[2].match(ALERT);
            // A quote inside a quote (`>>`) is a level deeper, and coloured as one.
            const level = `tok-q${Math.min(4, (quote[1].match(/>/g) || []).length - 1)}`;
            const rest = alert
                ? span(`tok-alert tok-alert-${alert[1].toLowerCase()}`, quote[2])
                : `<span class="tok-quote ${level}">${inlineHtml(quote[2])}</span>`;
            return span(`tok-marker ${level}`, quote[1]) + rest;
        }

        const item = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(?:(\[[ xX]\])(\s+))?(.*)$/);
        if (item) {
            // The marker takes the colour of its depth (two spaces, or a tab, a level).
            const depth = Math.min(5, Math.floor(item[1].replace(/\t/g, '    ').length / 2));
            return (
                escapeHtml(item[1]) +
                span(`tok-marker tok-l${depth}`, item[2]) +
                escapeHtml(item[3]) +
                (item[4] ? span('tok-task', item[4]) + escapeHtml(item[5]) : '') +
                inlineHtml(item[6])
            );
        }

        return inlineHtml(line);
    });
}
