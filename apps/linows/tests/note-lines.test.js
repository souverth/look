import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveLines, duplicateLines, deleteLines, openLine, joinLines, toggleComment } from '../src/js/screens/commands/note-lines.js';
import { renderMarkdown } from '../src/js/markdown.js';

// Applies an answer the way the editor does, marking the selection with [ ].
function run(text, [s, e], op, ...args) {
    const r = op(text, s, e, ...args);
    if (!r) return null;
    const next = text.slice(0, r.from) + r.insert + text.slice(r.to);
    const [a, b] = r.select;
    return b === a ? `${next.slice(0, a)}|${next.slice(a)}` : `${next.slice(0, a)}[${next.slice(a, b)}]${next.slice(b)}`;
}

test('Alt+Up / Alt+Down move the line, and the caret with it', () => {
    assert.equal(run('a\nb\nc', [3, 3], moveLines, 'up'), 'b|\na\nc');
    assert.equal(run('a\nb\nc', [0, 0], moveLines, 'down'), 'b\n|a\nc');
    assert.equal(run('a\nb\nc', [0, 0], moveLines, 'up'), null, 'top line cannot go up');
    assert.equal(run('a\nb\nc', [4, 4], moveLines, 'down'), null, 'bottom line cannot go down');
});

test('several selected lines move as one block', () => {
    assert.equal(run('a\nb\nc\nd', [2, 5], moveLines, 'down'), 'a\nd\n[b\nc]');
    assert.equal(run('a\nb\nc\nd', [2, 5], moveLines, 'up'), '[b\nc]\na\nd');
});

test('Alt+Enter copies the line below, the caret on the copy', () => {
    assert.equal(run('one\ntwo', [1, 1], duplicateLines, 'down'), 'one\no|ne\ntwo');
    assert.equal(run('x', [0, 0], duplicateLines, 'down'), 'x\n|x');
    assert.equal(run('one\ntwo', [5, 5], duplicateLines, 'up'), 'one\nt|wo\ntwo');
});

test('Ctrl+Shift+K deletes the line with its break', () => {
    assert.equal(run('a\nb\nc', [2, 2], deleteLines), 'a\n|c');
    assert.equal(run('a\nb\nc', [4, 4], deleteLines), 'a\nb|');
    assert.equal(run('only', [1, 1], deleteLines), '|');
});

test('Ctrl+Enter opens a line below, Ctrl+Shift+Enter above, at the indent', () => {
    assert.equal(run('  - a\nb', [3, 3], openLine, false), '  - a\n  |\nb');
    assert.equal(run('  - a\nb', [3, 3], openLine, true), '  |\n  - a\nb');
});

test('Ctrl+J joins the next line on, Ctrl+/ comments and uncomments', () => {
    assert.equal(run('a\n  b\nc', [0, 0], joinLines), 'a b|\nc');
    assert.equal(run('last', [0, 0], joinLines), null);
    assert.equal(run('a\n\nb', [0, 4], joinLines), 'a b|');
    assert.equal(run('hi\n\nyo', [0, 6], toggleComment), '[<!-- hi -->\n\n<!-- yo -->]');
    assert.equal(run('<!-- hi -->', [0, 0], toggleComment), '[hi]');
});

test('a one-line comment is left out of the preview', () => {
    assert.equal(renderMarkdown('<!-- note to self -->\ntext'), '<p>text</p>');
});
