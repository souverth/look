// Markdown editing helpers for /note's textarea: wrap the selection, continue a
// list on Enter, indent lines, replace a range. They act on the textarea in
// place, so the browser's own undo stack keeps working.
//
// The textarea is looked up per call: the screen builds its DOM in init(), after
// this module has loaded.

export function createEditing(getBody) {
    // Replace [start, end) with `text` and put the caret at `caret`. execCommand
    // keeps the browser's own undo stack (Ctrl+Z) intact; setRangeText is the
    // fallback where it is unavailable.
    function replaceRange(start, end, text, caret) {
        getBody().focus();
        getBody().setSelectionRange(start, end);
        let ok = false;
        try {
            ok = document.execCommand('insertText', false, text);
        } catch {
            ok = false;
        }
        if (!ok) {
            getBody().setRangeText(text, start, end, 'end');
            getBody().dispatchEvent(new Event('input'));
        }
        getBody().setSelectionRange(caret, caret);
    }

    function lineBounds(pos) {
        const v = getBody().value;
        const start = v.lastIndexOf('\n', pos - 1) + 1;
        let end = v.indexOf('\n', pos);
        if (end < 0) end = v.length;
        return [start, end];
    }

    function wrapSelection(mark) {
        const { selectionStart: s, selectionEnd: e, value } = getBody();
        const sel = value.slice(s, e);
        if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
            const inner = sel.slice(mark.length, sel.length - mark.length);
            replaceRange(s, e, inner, s + inner.length);
            getBody().setSelectionRange(s, s + inner.length);
            return;
        }
        replaceRange(s, e, `${mark}${sel}${mark}`, s + mark.length + sel.length);
        if (sel) getBody().setSelectionRange(s + mark.length, s + mark.length + sel.length);
    }

    // Enter on a list/quote line starts the next item; Enter on an empty one ends
    // the list. Returns false when the line is not a list so Enter stays native.
    function continueList() {
        const { selectionStart: pos, selectionEnd: end, value } = getBody();
        if (pos !== end) return false;
        const [ls] = lineBounds(pos);
        const before = value.slice(ls, pos);
        const m = before.match(/^(\s*)(?:([-*+])(?:\s+\[( |x|X)\])?|(\d+)([.)])|(>))\s+(.*)$/) ||
            before.match(/^(\s*)(?:([-*+])(?:\s+\[( |x|X)\])?|(\d+)([.)])|(>))\s*$/);
        if (!m) return false;
        const [, indent, bullet, task, num, numSep, quote] = m;
        const content = before.replace(/^(\s*)(?:[-*+](?:\s+\[[ xX]\])?|\d+[.)]|>)\s*/, '');
        if (!content.trim()) {
            // Empty item: drop the marker and leave a blank line.
            replaceRange(ls, pos, '', ls);
            return true;
        }
        let marker;
        if (quote) marker = '> ';
        else if (num) marker = `${Number(num) + 1}${numSep} `;
        else marker = `${bullet} ${task !== undefined ? '[ ] ' : ''}`;
        const insert = `\n${indent}${marker}`;
        replaceRange(pos, pos, insert, pos + insert.length);
        return true;
    }

    // Tab / Shift+Tab: indent or outdent every selected line by two spaces.
    function indentLines(outdent) {
        const { selectionStart: s, selectionEnd: e, value } = getBody();
        const [ls] = lineBounds(s);
        const [, le] = lineBounds(e);
        const lines = value.slice(ls, le).split('\n');
        let delta0 = 0;
        let total = 0;
        const out = lines.map((line, idx) => {
            let next;
            let d;
            if (outdent) {
                const m = line.match(/^( {1,2}|\t)/);
                d = m ? -m[0].length : 0;
                next = m ? line.slice(m[0].length) : line;
            } else {
                d = 2;
                next = `  ${line}`;
            }
            if (idx === 0) delta0 = d;
            total += d;
            return next;
        });
        if (s === e && !outdent) {
            // Plain Tab with no selection inserts the indent at the caret.
            replaceRange(s, s, '  ', s + 2);
            return;
        }
        replaceRange(ls, le, out.join('\n'), ls);
        getBody().setSelectionRange(Math.max(ls, s + delta0), e + total);
    }

    return { replaceRange, lineBounds, wrapSelection, continueList, indentLines };
}
