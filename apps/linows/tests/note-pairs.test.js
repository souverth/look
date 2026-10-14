import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typed, enter, backspace } from '../src/js/screens/commands/note-pairs.js';
import { closeOnGreater } from '../src/js/screens/commands/note-tags.js';

// Applies an answer the way the editor does; | marks the caret.
function run(text, [s, e], answer) {
    if (!answer) return null;
    if (answer.skip !== undefined) return `${text.slice(0, answer.skip)}|${text.slice(answer.skip)}`;
    const next = text.slice(0, answer.from) + answer.insert + text.slice(answer.to);
    const [a, b] = answer.select;
    return b === a ? `${next.slice(0, a)}|${next.slice(a)}` : `${next.slice(0, a)}[${next.slice(a, b)}]${next.slice(b)}`;
}
const type = (text, caret, ch) => run(text, [caret, caret], typed(text, caret, caret, ch));

test('an opener adds its closer, and typing the closer steps over it', () => {
    assert.equal(type('a', 1, '('), 'a(|)');
    assert.equal(type('f ', 2, '{'), 'f {|}');
    assert.equal(type('x = ', 4, '['), 'x = [|]');
    assert.equal(type('f()', 2, ')'), 'f()|', 'the existing closer is stepped over');
    assert.equal(type('"a"', 2, '"'), '"a"|');
});

test('no pair before a word, and quotes stay single inside words', () => {
    assert.equal(type('foo', 0, '('), null, 'before a word');
    assert.equal(type("don", 3, "'"), null, "don't");
    assert.equal(type('a = ', 4, "'"), "a = '|'");
    assert.equal(type('', 0, '`'), null, 'a backtick at line start is a fence');
    assert.equal(type('``', 2, '`'), null);
});

test('a selection is wrapped, not replaced', () => {
    assert.equal(run('say hi', [4, 6], typed('say hi', 4, 6, '"')), 'say ["hi"]'.replace('["hi"]', '"[hi]"'));
});

test('Enter keeps the indent, goes deeper after an opener and opens a block between {}', () => {
    assert.equal(run('  a', [3, 3], enter('  a', 3, 'ts')), '  a\n  |');
    assert.equal(run('if (x) {', [8, 8], enter('if (x) {', 8, 'ts')), 'if (x) {\n  |');
    assert.equal(run('f {}', [3, 3], enter('f {}', 3, 'ts')), 'f {\n  |\n}');
    assert.equal(run('  f {}', [5, 5], enter('  f {}', 5, 'rs')), '  f {\n      |\n  }', 'four spaces deeper in Rust');
    assert.equal(run('def go():', [9, 9], enter('def go():', 9, 'py')), 'def go():\n    |');
    assert.equal(enter('plain', 5, 'ts'), null, 'nothing to add: the key does its own thing');
});

test('Backspace takes an empty pair together', () => {
    assert.equal(run('f()', [2, 2], backspace('f()', 2)), 'f|');
    assert.equal(run('s = ""', [5, 5], backspace('s = ""', 5)), 's = |');
    assert.equal(backspace('f(a)', 3), null);
});

test('in markup any tag closes in its own case, but generics and void tags do not', () => {
    const m = { markup: true };
    assert.equal(closeOnGreater('<Button', 7, m), '</Button>');
    assert.equal(closeOnGreater('  <div className="x"', 20, m), '</div>');
    assert.equal(closeOnGreater('x = <Foo bar={1}', 16, m), '</Foo>');
    assert.equal(closeOnGreater('const u: Array<User', 19, m), null, 'a generic');
    assert.equal(closeOnGreater('<br', 3, m), null);
    assert.equal(closeOnGreater('<Input value="1" /', 18, m), null, 'already self-closed');
    assert.equal(closeOnGreater('<foo', 4, m), null, 'a lower-case name that is no HTML tag');
});
