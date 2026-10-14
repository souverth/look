import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodeHighlighter } from '../src/js/screens/commands/note-code-tokens.js';
import { highlightLines } from '../src/js/screens/commands/note-syntax.js';

const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

test('keywords, function names, strings, numbers and comments each get a class', () => {
    const hl = createCodeHighlighter('ts');
    const html = hl.line('function add(a, b) { return a + 42; } // sum "x"');
    assert.match(html, /tok-ckw">function</);
    assert.match(html, /tok-cfn">add</);
    assert.match(html, /tok-cnum">42</);
    assert.match(html, /tok-ckw">return</);
    assert.match(html, /tok-ccom">\/\/ sum &quot;x&quot;</);
    assert.equal(text(html), 'function add(a, b) { return a + 42; } // sum "x"', 'the text is untouched');
});

test('brackets take a colour by depth and come back to the first', () => {
    const html = createCodeHighlighter('js').line('a(b[c{d}])');
    const classes = [...html.matchAll(/tok-cbr(\d)">([^<]+)</g)].map((m) => `${m[2]}${m[1]}`);
    assert.deepEqual(classes, ['(0', '[1', '{2', '}2', ']1', ')0']);
});

test('a string stays one token, and a type is told from a plain word', () => {
    const hl = createCodeHighlighter('ts');
    assert.match(hl.line('const s = "a // not a comment";'), /tok-cstr">&quot;a \/\/ not a comment&quot;</);
    assert.match(hl.line('let u: User = x;'), /tok-ctype">User</);
    assert.ok(!/tok-c(?:kw|fn|type)">x</.test(hl.line('x')));
});

test('a block comment carries across lines', () => {
    const hl = createCodeHighlighter('c');
    assert.match(hl.line('int a; /* start'), /tok-ccom">\/\* start</);
    assert.match(hl.line('still comment'), /^<span class="tok-ccom">still comment<\/span>$/);
    assert.match(hl.line('end */ int b;'), /tok-ccom">end \*\/</);
    assert.match(hl.line('int c;'), /tok-ckw">int</);
});

test('hash comments need a word start, tags are coloured only in markup', () => {
    assert.match(createCodeHighlighter('py').line('x = 1  # note'), /tok-ccom"># note</);
    assert.ok(!/tok-ccom/.test(createCodeHighlighter('css').line('color: #fff;')));
    assert.match(createCodeHighlighter('tsx').line('<Button onClick={go}>Hi</Button>'), /tok-ctag">&lt;Button</);
    assert.ok(!/tok-ctag/.test(createCodeHighlighter('ts').line('if (a < b && c > d) {}')));
});

test('inside the editor a fenced line is highlighted by the language of its fence', () => {
    const lines = highlightLines('```py\ndef go(): return None\n```');
    assert.match(lines[1], /tok-ckw">def</);
    assert.match(lines[1], /tok-cfn">go</);
    assert.equal(text(lines[1]), 'def go(): return None');
});
