// Colours the code inside a fenced block while you type in /note: keywords,
// strings, numbers, comments, function names, types, tags and brackets (each
// nesting depth its own colour). One highlighter per block, fed line by line, so
// a /* comment */ spanning lines is remembered between them.
//
// Deliberately small and language-agnostic, not a parser: the text of every line
// comes back exactly as it went in, only wrapped in spans, which is what the
// editor needs to keep the caret and the text under it in step.

import { escapeHtml } from '../../markdown.js';
import { keywordsFor } from './note-code-assist.js';

const MARKUP = new Set(['html', 'jsx', 'tsx', 'vue', 'xml', 'svelte']);
const HASH = new Set(['py', 'bash', 'sh', 'powershell', 'rb', 'yaml', 'toml', 'dockerfile', 'makefile', 'ini', 'perl', 'r', 'elixir', 'terraform', 'nginx']);
const DASH = new Set(['sql', 'lua', 'haskell']);
const SLASH = new Set(['js', 'jsx', 'ts', 'tsx', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'kt', 'swift', 'php', 'dart', 'scala', 'css', 'scss', 'json', 'proto', 'sol', 'zig', 'groovy', 'vue', 'svelte', 'objc', 'fsharp']);
const BLOCK = new Set([...SLASH, 'sql']);

const span = (cls, text) => `<span class="${cls}">${escapeHtml(text)}</span>`;

const TOKEN = new RegExp(
    [
        '(\\s+)', //                                                     1: space
        '("(?:[^"\\\\]|\\\\.)*"?|\'(?:[^\'\\\\]|\\\\.)*\'?|`(?:[^`\\\\]|\\\\.)*`?)', // 2: string
        '(0[xX][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)', //  3: number
        '(<\\/?[A-Za-z][\\w.:-]*|\\/?>)', //                              4: tag name, or the end of one
        '([A-Za-z_$][\\w$]*)', //                                         5: word
        '([()\\[\\]{}])', //                                              6: bracket
    ].join('|'),
    'y',
);

/** One highlighter per block: `line(text)` -> the line's HTML, carrying state to the next. */
export function createCodeHighlighter(lang = '') {
    const keywords = keywordsFor(lang);
    const caseless = lang === 'sql';
    const markup = MARKUP.has(lang);
    const lineComment = HASH.has(lang) ? '#' : DASH.has(lang) ? '--' : SLASH.has(lang) || !lang ? '//' : '';
    const blockOpen = markup && !SLASH.has(lang) ? '<!--' : BLOCK.has(lang) || !lang ? '/*' : '';
    const blockClose = blockOpen === '<!--' ? '-->' : '*/';
    let inComment = false;
    let depth = 0;

    function line(text) {
        let out = '';
        let i = 0;
        while (i < text.length) {
            if (inComment) {
                const end = text.indexOf(blockClose, i);
                const stop = end < 0 ? text.length : end + blockClose.length;
                out += span('tok-ccom', text.slice(i, stop));
                if (end >= 0) inComment = false;
                i = stop;
                continue;
            }
            if (blockOpen && text.startsWith(blockOpen, i)) {
                const end = text.indexOf(blockClose, i + blockOpen.length);
                const stop = end < 0 ? text.length : end + blockClose.length;
                out += span('tok-ccom', text.slice(i, stop));
                inComment = end < 0;
                i = stop;
                continue;
            }
            // `#` starts a comment only at a word start: not `a#b`, not `#fff`.
            if (lineComment && text.startsWith(lineComment, i) && (lineComment !== '#' || /\s/.test(text[i - 1] ?? ' '))) {
                out += span('tok-ccom', text.slice(i));
                break;
            }
            TOKEN.lastIndex = i;
            const m = TOKEN.exec(text);
            if (!m) {
                out += escapeHtml(text[i]);
                i++;
                continue;
            }
            const [whole] = m;
            if (m[1]) out += escapeHtml(whole);
            else if (m[2]) out += span('tok-cstr', whole);
            else if (m[3]) out += span('tok-cnum', whole);
            // Tags are only tags in markup; elsewhere `<` and `>` are operators.
            else if (m[4]) out += markup ? span('tok-ctag', whole) : escapeHtml(whole);
            else if (m[5]) {
                const next = text.slice(i + whole.length).match(/^\s*(.)/)?.[1];
                if (keywords.has(caseless ? whole.toLowerCase() : whole)) out += span('tok-ckw', whole);
                else if (next === '(') out += span('tok-cfn', whole);
                else if (/^[A-Z]/.test(whole) && /[a-z]/.test(whole)) out += span('tok-ctype', whole);
                else out += escapeHtml(whole);
            } else {
                const open = '([{'.includes(whole);
                if (!open) depth = Math.max(0, depth - 1);
                out += span(`tok-cbr${depth % 3}`, whole);
                if (open) depth++;
            }
            i += whole.length;
        }
        return out;
    }

    return { line };
}
