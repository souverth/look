import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    todayIso,
    formatDate,
    firstLine,
    dropFirstLine,
    plainPreview,
    newId,
    PREVIEW_CHARS,
} from '../src/js/screens/commands/note-format.js';
import {
    TAG_HUES,
    tagPicks,
    tagIndex,
    swatchStyle,
    tagStyle,
} from '../src/js/screens/commands/note-tag-style.js';
import { createEditing } from '../src/js/screens/commands/note-editing.js';

// The slice of a textarea the editing helpers touch.
function fakeArea(value, start, end = start) {
    return {
        value,
        selectionStart: start,
        selectionEnd: end,
        focus() {},
        setSelectionRange(s, e) {
            this.selectionStart = s;
            this.selectionEnd = e;
        },
        setRangeText(text, s, e, mode) {
            this.value = this.value.slice(0, s) + text + this.value.slice(e);
            if (mode === 'end') this.selectionStart = this.selectionEnd = s + text.length;
        },
        dispatchEvent() {
            return true;
        },
    };
}

// No execCommand under node: the helpers fall back to setRangeText.
globalThis.document = { execCommand: () => false };

const editingOn = (area) => createEditing(() => area);

test('Enter on a list item starts the next one', () => {
    const bullet = fakeArea('- one', 5);
    assert.equal(editingOn(bullet).continueList(), true);
    assert.equal(bullet.value, '- one\n- ');

    const numbered = fakeArea('1. a', 4);
    editingOn(numbered).continueList();
    assert.equal(numbered.value, '1. a\n2. ');

    const task = fakeArea('- [x] done', 10);
    editingOn(task).continueList();
    assert.equal(task.value, '- [x] done\n- [ ] ', 'a new task starts unticked');

    const quote = fakeArea('> said', 6);
    editingOn(quote).continueList();
    assert.equal(quote.value, '> said\n> ');
});

test('Enter on an empty list item ends the list; on plain text it stays native', () => {
    const empty = fakeArea('- one\n- ', 8);
    assert.equal(editingOn(empty).continueList(), true);
    assert.equal(empty.value, '- one\n');

    const plain = fakeArea('just text', 9);
    assert.equal(editingOn(plain).continueList(), false);
    assert.equal(plain.value, 'just text');

    const selecting = fakeArea('- one', 0, 5);
    assert.equal(editingOn(selecting).continueList(), false, 'a selection is left to the browser');
});

test('wrapping a selection toggles the mark', () => {
    const area = fakeArea('make bold here', 5, 9);
    const ed = editingOn(area);
    ed.wrapSelection('**');
    assert.equal(area.value, 'make **bold** here');
    assert.deepEqual([area.selectionStart, area.selectionEnd], [7, 11]);

    area.setSelectionRange(5, 13);
    ed.wrapSelection('**');
    assert.equal(area.value, 'make bold here');
});

test('Tab indents every selected line by two spaces and Shift+Tab takes it back', () => {
    const area = fakeArea('a\nb\nc', 0, 5);
    const ed = editingOn(area);
    ed.indentLines(false);
    assert.equal(area.value, '  a\n  b\n  c');
    ed.indentLines(true);
    assert.equal(area.value, 'a\nb\nc');

    const caret = fakeArea('word', 2);
    editingOn(caret).indentLines(false);
    assert.equal(caret.value, 'wo  rd', 'no selection: the indent goes in at the caret');
});

test('lineBounds finds the line around a position', () => {
    const ed = editingOn(fakeArea('ab\ncde\nf', 0));
    assert.deepEqual(ed.lineBounds(4), [3, 6]);
    assert.deepEqual(ed.lineBounds(0), [0, 2]);
    assert.deepEqual(ed.lineBounds(8), [7, 8]);
});

test('a card shows words, not Markdown syntax', () => {
    assert.equal(plainPreview('# Title\n- [ ] task\n**bold** and `code`'), 'Title task bold and code');
    assert.equal(plainPreview('see [docs](http://x.y) now'), 'see docs now');
    assert.equal(plainPreview('x'.repeat(PREVIEW_CHARS + 100)).length, PREVIEW_CHARS);
});

test('the headline is the first non-blank line, and the rest is the body', () => {
    assert.equal(firstLine('\n\n## Plan\nmore'), 'Plan');
    assert.equal(firstLine(''), '');
    assert.equal(dropFirstLine('\nhead\nbody 1\nbody 2'), 'body 1\nbody 2');
    assert.equal(dropFirstLine('only'), '');
    assert.equal(dropFirstLine('  \n '), '');
});

test('dates read as today, this year, or another year', () => {
    const now = new Date(2026, 9, 13, 15, 0);
    const at = (y, m, d, h = 9, min = 5) => new Date(y, m, d, h, min).getTime() / 1000;
    assert.equal(formatDate(at(2026, 9, 13), now), 'Today 09:05');
    assert.equal(formatDate(at(2026, 2, 3), now), 'Mar 3');
    assert.equal(formatDate(at(2024, 11, 25), now), 'Dec 25 2024');
    assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
    assert.notEqual(newId(), newId());
});

test('a tag has a stable colour unless the user picked one', () => {
    tagPicks.clear();
    const auto = tagIndex('dev');
    assert.ok(auto >= 0 && auto < TAG_HUES.length);
    assert.equal(tagIndex('dev'), auto, 'derived from the name, so it never shifts');
    tagPicks.set('dev', (auto + 1) % TAG_HUES.length);
    assert.equal(tagIndex('dev'), (auto + 1) % TAG_HUES.length);
    assert.equal(tagStyle('dev'), swatchStyle((auto + 1) % TAG_HUES.length));
    tagPicks.clear();
    assert.match(swatchStyle(0), /^--tag-bg:hsl\(212 68% 72%\);--tag-fg:hsl\(212 45% 16%\)$/);
});
