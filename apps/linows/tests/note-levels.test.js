import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftLevel } from '../src/js/screens/commands/note-lines.js';

function run(text, [s, e], dir) {
    const r = shiftLevel(text, s, e, dir);
    if (!r) return null;
    const next = text.slice(0, r.from) + r.insert + text.slice(r.to);
    const [a, b] = r.select;
    return b === a ? `${next.slice(0, a)}|${next.slice(a)}` : `${next.slice(0, a)}[${next.slice(a, b)}]${next.slice(b)}`;
}

test('Tab moves a list item one level in, wherever the caret is in it', () => {
    assert.equal(run('- one', [4, 4], 1), '  - on|e');
    assert.equal(run('- one\n  - two', [11, 11], 1), '- one\n    - t|wo');
    assert.equal(run('1. a', [0, 0], 1), '  |1. a');
});

test('Shift+Tab takes it back out, and stops at the margin', () => {
    assert.equal(run('    - x', [7, 7], -1), '  - x|');
    assert.equal(run('- x', [3, 3], -1), '- x|');
});

test('on a heading Tab adds a # and Shift+Tab takes one away, between 1 and 6', () => {
    assert.equal(run('## Title', [8, 8], 1), '### Title|');
    assert.equal(run('### Title', [9, 9], -1), '## Title|');
    assert.equal(run('# Title', [7, 7], -1), '# Title|', 'h1 stays h1');
    assert.equal(run('###### Six', [10, 10], 1), '###### Six|', 'h6 is the last level');
    assert.equal(run('#', [1, 1], 1), '##|');
});

test('a selection of lines changes each by its kind', () => {
    const text = '## A\n- b\nplain';
    assert.equal(run(text, [0, text.length], 1), '[### A\n  - b\n  plain]');
});

test('one ordinary line is left to the key', () => {
    assert.equal(shiftLevel('just text', 4, 4, 1), null);
    assert.equal(shiftLevel('just text', 4, 4, -1), null);
});

test('Shift+Tab on an empty item at the margin drops its marker; one with text stays', () => {
    assert.equal(run('a\n- ', [4, 4], -1), 'a\n|');
    assert.equal(run('3. ', [3, 3], -1), '|');
    assert.equal(run('  - ', [4, 4], -1), '- |', 'an indented empty item first steps out');
    assert.equal(run('- keep', [6, 6], -1), '- keep|', 'text is never thrown away');
});

test('a numbered item that moves in starts again at 1; moving out it takes the next number', () => {
    const atEnd = (text, dir) => run(text, [text.length, text.length], dir);
    assert.equal(atEnd('1. a\n2. b', 1), '1. a\n  1. b|', 'the child of 1. is 1.');
    assert.equal(atEnd('1. a\n  1. b\n  2. c', 1), '1. a\n  1. b\n    1. c|', 'a first child again');
    assert.equal(atEnd('1. a\n  1. b\n2. c', 1), '1. a\n  1. b\n  2. c|', 'beside an earlier child it carries on');
    assert.equal(atEnd('1. a\n  1. b\n  2. c', -1), '1. a\n  1. b\n2. c|', 'out: one past the item at that level');
    assert.equal(atEnd('1. a\n  1. b', -1), '1. a\n2. b|');
    assert.equal(atEnd('- a\n  1. b', -1), '- a\n1. b|', 'beside a bullet it starts a list of its own');
});