// Small Markdown renderer for the /note preview. Not a full CommonMark
// implementation: it covers what quick notes use (headings, emphasis, inline
// code, fenced code, quotes, bullet/numbered/task lists, rules, links). Every
// piece of user text is HTML-escaped before any markup is added, so the output
// is safe to assign to innerHTML.

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
    out = out
        .replace(
            /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
            '<span class="md-link" title="$2">$1</span>',
        )
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

// What follows the opening ``` : a language, and optionally the file the code
// comes from. Accepted forms (the path is shown only when the author gives one):
//   ```ts                      language only
//   ```ts:src/app.ts           language:path
//   ```ts title="src/app.ts"   title= / file= / filename= / path=
//   ```ts src/app.ts           language then a bare path
//   ```src/app.ts              a path alone (language comes from its extension)
export function parseFenceInfo(info) {
    const text = info.trim();
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
    return { lang: lang.toLowerCase(), path: path.trim().slice(0, 200) };
}

// A code block: header (file path with the name emphasised, or just the
// language) with a Copy button, then the code. The code is highlighted after
// rendering (see highlightCodeBlocks in note.js); until then, and for unknown
// languages, it is plain escaped text.
function codeBlock(code, { lang, path }) {
    let title = '';
    if (path) {
        const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
        title = `<span class="md-code-file" title="${escapeHtml(path)}"><span class="md-code-dir">${escapeHtml(path.slice(0, cut))}</span><b>${escapeHtml(path.slice(cut))}</b></span>`;
    }
    const label = lang ? `<span class="md-code-lang">${escapeHtml(lang)}</span>` : '';
    return (
        `<div class="md-code"><div class="md-code-head">${title || '<span class="md-code-file"></span>'}${label}` +
        `<button type="button" class="md-copy" title="Copy code">Copy</button></div>` +
        `<pre><code data-lang="${escapeHtml(lang)}">${escapeHtml(code)}</code></pre></div>`
    );
}

const LIST_RE =/^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

// `offset` is the source line the text starts on, so task items can carry the
// line they came from (data-line) and the preview can tick them in the source.
export function renderMarkdown(src, offset = 0) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
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
            html.push(`<blockquote>${renderMarkdown(quote.join('\n'), offset + quoteStart)}</blockquote>`);
            continue;
        }

        const first = line.match(LIST_RE);
        if (first) {
            flushPara();
            const ordered = /\d/.test(first[2]);
            const items = [];
            while (i < lines.length) {
                const m = lines[i].match(LIST_RE);
                if (!m || /\d/.test(m[2]) !== ordered) break;
                const task = m[3].match(/^\[( |x|X)\]\s+(.*)$/);
                const depth = Math.min(3, Math.floor(m[1].replace(/\t/g, '    ').length / 2));
                const done = task && task[1] !== ' ';
                const body = task
                    ? `<span class="md-check" role="checkbox" aria-checked="${done}"></span><span class="md-task-text">${inline(task[2])}</span>`
                    : inline(m[3]);
                const cls = `md-d${depth}${task ? ' md-task' : ''}${done ? ' md-done' : ''}`;
                items.push(`<li class="${cls}"${task ? ` data-line="${offset + i}"` : ''}>${body}</li>`);
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
