// The look of /note's editor: Markdown colours and a line-number gutter around a
// plain textarea.
//
// The textarea keeps doing all the editing (caret, selection, undo, IME), with
// its text made transparent. Behind it sits an overlay laying the same text out
// one block per source line, coloured by note-syntax.js. The gutter numbers
// those blocks: each number is as tall as its block, so a line that wraps over
// three rows still gets one number, at the top, and the rest line up below.
//
//   gutter | stack: [ overlay (behind) ][ textarea (in front, transparent) ]
//
// This is the only DOM-aware part; what to colour and how is note-syntax.js.

import { highlightLines } from './note-syntax.js';
import { escapeHtml } from '../../markdown.js';

/**
 * `stack` holds the overlay and the textarea; `gutter` is the number column.
 * Returns `{ configure, refresh, refreshNow, markActive, syncScroll }`.
 */
export function createEditorView({ stack, textarea, overlay, gutter }) {
    let options = { lineNumbers: true, highlight: true, wrap: true };
    let frame = 0;
    let active = -1;

    const enabled = () => options.lineNumbers || options.highlight;

    function configure(next) {
        options = { ...options, ...next };
        stack.dataset.hl = options.highlight ? 'on' : 'off';
        stack.dataset.wrap = options.wrap ? 'on' : 'off';
        textarea.wrap = options.wrap ? 'soft' : 'off';
        gutter.hidden = !options.lineNumbers;
        overlay.hidden = !enabled();
        active = -1;
        refreshNow();
    }

    /** Redraw on the next frame: many keystrokes, one draw. */
    function refresh() {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            render();
        });
    }

    /** Redraw now, for a change made in code that fires no `input` event. */
    function refreshNow() {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        render();
    }

    function render() {
        if (!enabled()) return;
        const source = textarea.value;
        const lines = options.highlight
            ? highlightLines(source)
            : source.replace(/\r\n?/g, '\n').split('\n').map(escapeHtml);
        // An empty line still has to be as tall as a line; a zero-width space is
        // the one character that gives it a row and shows nothing.
        overlay.innerHTML = lines
            .map((html) => `<div class="hl-line">${html || '​'}</div>`)
            .join('');

        // The textarea's scrollbar narrows its text; the overlay has none, so it
        // is given the same width back or the two would wrap differently.
        stack.style.setProperty(
            '--ed-sbw',
            `${Math.max(0, textarea.offsetWidth - textarea.clientWidth)}px`,
        );

        if (options.lineNumbers) {
            // All the writing above first, all the reading here: one layout.
            // Fractional heights, not offsetHeight: a line is 20.15px tall, and
            // rounding each to 20 would walk the numbers off their lines. Passed
            // on as they are: layout works in 1/64 px, which a height read back
            // from it spells exactly, and a rounded one would lose a sliver per line.
            const rows = overlay.children;
            let html = '';
            for (let i = 0; i < rows.length; i++) {
                const height = rows[i].getBoundingClientRect().height;
                html += `<div style="height:${height}px">${i + 1}</div>`;
            }
            gutter.innerHTML = html;
            gutter.style.setProperty('--digits', String(String(rows.length).length));
        }
        syncScroll();
        markActive();
    }

    function syncScroll() {
        overlay.scrollTop = textarea.scrollTop;
        overlay.scrollLeft = textarea.scrollLeft;
        gutter.scrollTop = textarea.scrollTop;
    }

    // The line the caret is on, picked out in both columns. Not while a range is
    // selected: the selection says where you are better than a stripe would.
    function caretLine() {
        if (textarea.selectionStart !== textarea.selectionEnd) return -1;
        const value = textarea.value;
        const end = textarea.selectionStart;
        let line = 0;
        for (let i = value.indexOf('\n'); i !== -1 && i < end; i = value.indexOf('\n', i + 1)) {
            line++;
        }
        return line;
    }

    function markActive() {
        if (!enabled()) return;
        const next = caretLine();
        if (next === active && overlay.children[next]?.classList.contains('is-active')) return;
        for (const column of [overlay, gutter]) {
            column.children[active]?.classList.remove('is-active');
            column.children[next]?.classList.add('is-active');
        }
        active = next;
    }

    textarea.addEventListener('input', refresh);
    textarea.addEventListener('scroll', syncScroll);
    for (const type of ['keyup', 'mouseup', 'focus', 'select']) {
        textarea.addEventListener(type, markActive);
    }
    textarea.addEventListener('blur', () => {
        for (const column of [overlay, gutter]) column.children[active]?.classList.remove('is-active');
        active = -1;
    });
    // A pane that changes width (the window, a split view) re-wraps its lines.
    if (typeof ResizeObserver === 'function') new ResizeObserver(refresh).observe(stack);

    return { configure, refresh, refreshNow, markActive, syncScroll };
}
