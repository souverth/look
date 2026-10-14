// The look of /note's editor: Markdown colours, a line-number gutter and folding
// around a plain textarea.
//
// The textarea keeps doing all the editing (caret, selection, undo, IME), with
// its text made transparent. Behind it sits an overlay laying the same text out
// one block per source line, coloured by note-syntax.js. The gutter numbers
// those blocks: each number is as tall as its block, so a line that wraps over
// three rows still gets one number, at the top, and the rest line up below.
//
//   gutter | stack: [ overlay (behind) ][ textarea (in front, transparent) ]
//
// Folding. A textarea cannot hide a line, so with folds in force it holds a shorter
// text (the "display"), and this view keeps the whole note (the "source"). Everything
// outside this file keeps seeing the whole note: `textarea.value`, `selectionStart`,
// `selectionEnd`, `setSelectionRange` and `setRangeText` are answered in source terms
// here. A fold opens by itself before an edit could reach into it; an edit anywhere
// else is carried into the source exactly. The arithmetic is note-folds.js.
//
// This is the only DOM-aware part; what to colour and how is note-syntax.js.

import { highlightLines } from './note-syntax.js';
import { escapeHtml } from '../../markdown.js';
import {
    foldRegions,
    layout,
    toSource,
    toDisplay,
    applyDisplayEdit,
    shiftFolds,
    foldsTouched,
} from './note-folds.js';

// The textarea's own accessors, for what is on screen (the display); the instance's are
// replaced below so the rest of the editor sees the note.
const proto = HTMLTextAreaElement.prototype;
const nativeValue = Object.getOwnPropertyDescriptor(proto, 'value');
const nativeStart = Object.getOwnPropertyDescriptor(proto, 'selectionStart');
const nativeEnd = Object.getOwnPropertyDescriptor(proto, 'selectionEnd');
const nativeSetSelection = proto.setSelectionRange;
const nativeSetRangeText = proto.setRangeText;

/**
 * `stack` holds the overlay and the textarea; `gutter` is the number column.
 * Returns `{ configure, refresh, refreshNow, markActive, syncScroll, ...folding }`.
 */
export function createEditorView({ stack, textarea, overlay, gutter }) {
    let options = { lineNumbers: true, highlight: true, wrap: true };
    let frame = 0;
    let active = -1;
    let painted = []; // the overlay's rows as last drawn
    let paintedGutter = '';
    // An empty line still has to be as tall as a line; a zero-width space is the
    // one character that gives it a row and shows nothing.
    const EMPTY_LINE = '​';

    // --- The note, and what of it is shown ---
    const display = () => nativeValue.get.call(textarea);
    const setDisplay = (text) => nativeValue.set.call(textarea, text);
    const displayStart = () => nativeStart.get.call(textarea);
    const displayEnd = () => nativeEnd.get.call(textarea);

    let source = display();
    let folded = new Set(); // lines that start a fold in force
    let regions = []; // what can fold
    let map = layout(source, folded, regions);
    const folding = () => map.effective.size > 0;
    const toNote = (offset) => (folding() ? toSource(map, offset) : offset);
    const toScreen = (offset) => (folding() ? toDisplay(map, offset) : offset);

    const enabled = () => options.lineNumbers || options.highlight;

    function configure(next) {
        options = { ...options, ...next };
        stack.dataset.hl = options.highlight ? 'on' : 'off';
        stack.dataset.wrap = options.wrap ? 'on' : 'off';
        stack.dataset.caret = options.smooth !== false ? 'smooth' : 'native';
        textarea.wrap = options.wrap ? 'soft' : 'off';
        gutter.hidden = !options.lineNumbers;
        overlay.hidden = !enabled();
        active = -1;
        painted = [];
        paintedGutter = '';
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
        // What can fold is read afresh: the text may have changed under it.
        regions = foldRegions(source);
        const foldStarts = new Set(regions.map((r) => r.start));
        // A fold whose region is gone has to open, or its lines would stay hidden.
        if ([...folded].some((line) => !foldStarts.has(line))) reshow(new Set([...folded].filter((l) => foldStarts.has(l))));
        if (!enabled()) return;

        // Coloured against the whole note (a fence may open in a hidden line), then
        // only the shown lines are drawn.
        const all = options.highlight
            ? highlightLines(source)
            : source.split('\n').map(escapeHtml);
        const rows = map.visible.map((row) => {
            const end = map.effective.get(row.line);
            const pill = end === undefined ? '' : `<span class="hl-fold">${end - row.line} ${end - row.line === 1 ? 'line' : 'lines'}</span>`;
            return { html: `${all[row.line] ?? ''}${pill}`, folded: end !== undefined };
        });

        // Only the lines that changed are touched: re-parsing the whole note on
        // every key is what made long notes stutter, and untouched lines keep
        // their DOM (and the active-line fade) as they are.
        const same = painted.length === rows.length && overlay.children.length === rows.length;
        if (same) {
            for (let i = 0; i < rows.length; i++) {
                const el = overlay.children[i];
                if (rows[i].html !== painted[i].html) el.innerHTML = rows[i].html || EMPTY_LINE;
                if (rows[i].folded !== painted[i].folded) el.classList.toggle('is-folded', rows[i].folded);
            }
        } else {
            overlay.innerHTML = rows
                .map((row) => `<div class="hl-line${row.folded ? ' is-folded' : ''}">${row.html || EMPTY_LINE}</div>`)
                .join('');
            overlay.children[active]?.classList.add('is-active');
        }
        painted = rows;

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
            const starts = new Map(regions.map((r) => [r.start, r]));
            const shown = overlay.children;
            let html = '';
            for (let i = 0; i < shown.length; i++) {
                const height = shown[i].getBoundingClientRect().height;
                const line = map.visible[i].line;
                // A line that can fold has an arrow after its number: down while open, right when folded.
                const arrow = starts.has(line)
                    ? `<i class="gf ${map.effective.has(line) ? 'closed' : 'open'}" data-line="${line}"></i>`
                    : '<i class="gf-none"></i>';
                html += `<div style="height:${height}px"><span class="gn">${line + 1}</span>${arrow}</div>`;
            }
            // Rewritten only when a number or a height changed, so the numbers
            // (and their fade) stay put while typing within a line.
            if (html !== paintedGutter) {
                gutter.innerHTML = html;
                paintedGutter = html;
                gutter.children[active]?.classList.add('is-active');
            }
            gutter.style.setProperty('--digits', String(String(map.lineCount).length));
        }
        syncScroll();
        markActive();
    }

    function syncScroll() {
        overlay.scrollTop = textarea.scrollTop;
        overlay.scrollLeft = textarea.scrollLeft;
        gutter.scrollTop = textarea.scrollTop;
        placeCaret();
    }

    // --- Smooth caret ---
    //
    // A textarea's own caret jumps. This one is a thin bar laid over the text that
    // glides to where the caret is, so typing and arrow keys feel continuous. The
    // position is read from the overlay, whose text is laid out exactly as the
    // textarea's: a Range at the caret's offset in its line gives the rectangle.
    // The native caret is made transparent while the bar is in charge.
    const caretEl = document.createElement('div');
    caretEl.className = 'cmd-note-caret';
    caretEl.hidden = true;
    caretEl.setAttribute('aria-hidden', 'true');
    stack.appendChild(caretEl);
    let caretShown = false;
    let moving = 0;

    function caretRect() {
        const value = display();
        const pos = displayStart();
        const row = overlay.children[caretLine()];
        if (!row) return null;
        let want = pos - (value.lastIndexOf('\n', pos - 1) + 1);
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let node = null;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            node = n;
            if (want <= n.data.length) break;
            want -= n.data.length;
        }
        const lh = parseFloat(getComputedStyle(row).lineHeight) || 20;
        const range = document.createRange();
        if (node) range.setStart(node, Math.min(want, node.data.length));
        else range.setStart(row, 0);
        range.collapse(true);
        const rects = range.getClientRects();
        const r = rects.length ? rects[0] : row.getBoundingClientRect();
        const base = stack.getBoundingClientRect();
        return { x: r.left - base.left, y: r.top - base.top + r.height / 2 - lh / 2, h: lh };
    }

    function placeCaret() {
        const smooth =
            stack.dataset.caret === 'smooth' &&
            enabled() &&
            !overlay.hidden &&
            document.activeElement === textarea &&
            displayStart() === displayEnd();
        const rect = smooth ? caretRect() : null;
        const base = stack.getBoundingClientRect();
        if (!rect || rect.y < -rect.h || rect.y > base.height) {
            caretEl.hidden = true;
            caretShown = false;
            return;
        }
        // The first placement lands where it is; only later ones glide.
        caretEl.classList.toggle('jump', !caretShown);
        caretEl.hidden = false;
        caretEl.style.height = `${rect.h}px`;
        caretEl.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
        caretShown = true;
        // A bar that is moving stays solid; it blinks once it has rested.
        caretEl.classList.add('moving');
        clearTimeout(moving);
        moving = setTimeout(() => caretEl.classList.remove('moving'), 450);
    }

    // The line the caret is on (a row of the overlay), picked out in both columns. Not
    // while a range is selected: the selection says where you are better than a stripe would.
    function caretLine() {
        if (displayStart() !== displayEnd()) return -1;
        const value = display();
        const end = displayStart();
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

    // --- Folding ---

    // Shows the note with `next` folded, the caret and selection staying on the same
    // text and the scroll where it was.
    function reshow(next) {
        const from = toNote(displayStart());
        const to = toNote(displayEnd());
        folded = new Set(next);
        map = layout(source, folded, regions);
        folded = new Set(map.effective.keys());
        const top = textarea.scrollTop;
        if (display() !== map.display) setDisplay(map.display);
        nativeSetSelection.call(textarea, toDisplay(map, from), toDisplay(map, to));
        textarea.scrollTop = top;
    }

    function setFolds(next) {
        reshow(next);
        refreshNow();
    }

    const regionAt = (line) => regions.find((r) => r.start === line);

    // The source line number (from 0) of a source offset.
    const lineOfNote = (offset) => {
        let n = 0;
        for (let i = source.indexOf('\n'); i !== -1 && i < offset; i = source.indexOf('\n', i + 1)) n++;
        return n;
    };

    /** Folds or opens the region that starts on `line`; `all`: every region like it (same kind and level). */
    function toggleFold(line, all = false) {
        const region = regionAt(line);
        if (!region) return;
        const next = new Set(folded);
        const closing = !next.has(line);
        const level = (l) => (source.split('\n')[l].match(/^#+/) || [''])[0].length;
        const same = (r) => r.kind === region.kind && (r.kind !== 'heading' || level(r.start) === level(line));
        for (const r of all ? regions.filter(same) : [region]) {
            if (closing) next.add(r.start);
            else next.delete(r.start);
        }
        setFolds(next);
    }

    /** Folds the region the caret is in: the one starting on its line, else the innermost around it. */
    function foldAtCaret() {
        const line = lineOfNote(toNote(displayStart()));
        const around = regions
            .filter((r) => r.start <= line && line <= r.end && !folded.has(r.start))
            .sort((a, b) => b.start - a.start || a.end - b.end);
        const own = around.find((r) => r.start === line);
        const region = own ?? around[0];
        if (!region) return false;
        setFolds(new Set([...folded, region.start]));
        return true;
    }

    /** Opens the fold on the caret's line. */
    function unfoldAtCaret() {
        const line = lineOfNote(toNote(displayStart()));
        if (!folded.has(line)) return false;
        const next = new Set(folded);
        next.delete(line);
        setFolds(next);
        return true;
    }

    function foldAll() {
        setFolds(new Set(regions.map((r) => r.start)));
    }

    function unfoldAll() {
        if (folding()) setFolds(new Set());
    }

    // --- The textarea as the rest of the editor sees it: the whole note ---

    // Something is about to change the text: whatever the change would reach opens first.
    function openFoldsFor(from, to) {
        const touched = foldsTouched(map, map.display, from, to);
        if (!touched.length) return;
        const next = new Set(folded);
        touched.forEach((line) => next.delete(line));
        reshow(next);
    }

    function openAllFolds() {
        if (folding()) reshow(new Set());
    }

    Object.defineProperties(textarea, {
        value: {
            configurable: true,
            get: () => (folding() ? source : display()),
            set(text) {
                setDisplay(text);
                source = display();
                folded = new Set();
                regions = foldRegions(source);
                map = layout(source, folded, regions);
            },
        },
        selectionStart: {
            configurable: true,
            get: () => toNote(displayStart()),
            set: (offset) => textarea.setSelectionRange(offset, toNote(displayEnd())),
        },
        selectionEnd: {
            configurable: true,
            get: () => toNote(displayEnd()),
            set: (offset) => textarea.setSelectionRange(toNote(displayStart()), offset),
        },
    });

    // A selection is given in note offsets. One that reaches into a fold opens the
    // folds first, so it is never put somewhere it cannot be shown.
    textarea.setSelectionRange = (from, to, direction) => {
        if (folding()) {
            // The index of the last shown line that starts at or before an offset (no
            // findLastIndex: older webviews lack it).
            const rowAt = (offset) => {
                let found = -1;
                for (let i = 0; i < map.visible.length && map.visible[i].src <= offset; i++) found = i;
                return found;
            };
            const hidden = (offset) => {
                const row = map.visible[rowAt(offset)];
                return !row || offset > row.src + row.length;
            };
            // Between two shown lines that are not neighbours, a hidden block lies.
            const spans = () => {
                const a = rowAt(from);
                const b = rowAt(to);
                return a >= 0 && b > a && map.visible[b].line !== map.visible[a].line + (b - a);
            };
            if (hidden(from) || hidden(to) || spans()) openAllFolds();
            // A range (not a caret) is what the editor selects to replace or delete; on a
            // folded line it opens that fold first. execCommand sends no beforeinput, so
            // this is where the folds are told in code that edits through it.
            if (folding() && from !== to) openFoldsFor(toScreen(from), toScreen(to));
        }
        nativeSetSelection.call(textarea, toScreen(from), toScreen(to), direction);
    };

    textarea.setRangeText = (...args) => {
        openAllFolds();
        return nativeSetRangeText.apply(textarea, args);
    };

    textarea.addEventListener('beforeinput', (event) => {
        if (!folding() || event.isComposing) return;
        const from = displayStart();
        const to = displayEnd();
        // Everything selected and then typed over or deleted is the whole note, not what shows.
        if (from === 0 && to === map.display.length && to > 0) {
            openAllFolds();
            nativeSetSelection.call(textarea, 0, display().length);
            return;
        }
        // A delete or backspace also reaches the line break beside the caret.
        const deleting = /^delete/.test(event.inputType);
        openFoldsFor(deleting ? Math.max(0, from - 1) : from, deleting ? Math.min(map.display.length, to + 1) : to);
    });

    // An edit of the display is carried into the note; the hidden lines are not touched.
    textarea.addEventListener('input', () => {
        const after = display();
        if (!folding()) {
            source = after;
            // Native edits bypass the value setter. Rebuild the rows as well as
            // the text, or the overlay keeps the old line count after Enter.
            regions = foldRegions(source);
            map = layout(source, folded, regions);
            refresh();
            return;
        }
        const edit = applyDisplayEdit(source, map, after);
        if (!edit) {
            // It would have reached a hidden line: put things back and show everything.
            setDisplay(map.display);
            openAllFolds();
            refresh();
            return;
        }
        const from = edit.toNewSource(displayStart());
        const to = edit.toNewSource(displayEnd());
        source = edit.source;
        regions = foldRegions(source);
        const next = layout(source, shiftFolds(folded, edit.line, edit.delta), regions);
        folded = new Set(next.effective.keys());
        map = next;
        // A fold the edit left without a region opens; the display follows the note.
        if (after !== map.display) {
            setDisplay(map.display);
            nativeSetSelection.call(textarea, toDisplay(map, from), toDisplay(map, to));
        }
        refresh();
    });

    // Copying shows the whole of what is selected, hidden lines in between included.
    const copyWhole = (event) => {
        if (!folding() || displayStart() === displayEnd()) return;
        const text = source.slice(toNote(displayStart()), toNote(displayEnd()));
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
    };
    textarea.addEventListener('copy', copyWhole);
    textarea.addEventListener('cut', (event) => {
        if (!folding() || displayStart() === displayEnd()) return;
        copyWhole(event);
        // The cut itself was cancelled with the copy: delete what is selected, which
        // opens whatever it reaches first.
        document.execCommand('delete');
    });

    // The arrows in the gutter; Alt-click folds or opens every one of the same kind.
    gutter.addEventListener('mousedown', (event) => {
        const arrow = event.target.closest?.('.gf');
        if (!arrow) return;
        event.preventDefault();
        toggleFold(Number(arrow.dataset.line), event.altKey);
    });

    textarea.addEventListener('scroll', syncScroll);
    for (const type of ['keyup', 'mouseup', 'focus', 'select']) {
        textarea.addEventListener(type, markActive);
        textarea.addEventListener(type, placeCaret);
    }
    // Keys that move the caret act after keydown, and repeat while held.
    // The stripe and the caret move together, on the key going down (and not, as keyup
    // would have it, only when it comes back up: holding an arrow left the stripe behind).
    const follow = () =>
        requestAnimationFrame(() => {
            markActive();
            placeCaret();
        });
    textarea.addEventListener('keydown', follow);
    textarea.addEventListener('mousedown', follow);
    textarea.addEventListener('beforeinput', follow);
    textarea.addEventListener('blur', () => {
        caretEl.hidden = true;
        caretShown = false;
        for (const column of [overlay, gutter]) column.children[active]?.classList.remove('is-active');
        active = -1;
    });
    // A pane that changes width (the window, a split view) re-wraps its lines.
    if (typeof ResizeObserver === 'function') new ResizeObserver(refresh).observe(stack);

    return {
        configure,
        refresh,
        refreshNow,
        markActive,
        syncScroll,
        toggleFold,
        foldAtCaret,
        unfoldAtCaret,
        foldAll,
        unfoldAll,
        foldCount: () => map.effective.size,
        /** What the textarea shows (the note without the folded lines), and where a note offset is in it. */
        displayText: () => (folding() ? map.display : display()),
        toDisplayOffset: toScreen,
    };
}
