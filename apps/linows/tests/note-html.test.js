import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagContext, filterTags, tagInsert, closeOnGreater } from '../src/js/screens/commands/note-tags.js';
import { renderMarkdown } from '../src/js/markdown.js';
import { highlightLines } from '../src/js/screens/commands/note-syntax.js';

test('"<" and letters before the caret open the tag list', () => {
    assert.deepEqual(tagContext('x <ab', 5), { from: 2, prefix: 'ab' });
    assert.deepEqual(tagContext('<', 1), { from: 0, prefix: '' });
    assert.equal(tagContext('a<b', 3), null, 'maths, not a tag');
    assert.equal(tagContext('a < b', 5), null);
    assert.ok(filterTags('ab').includes('abbr'));
    assert.ok(filterTags('').length > 50);
    assert.deepEqual(filterTags('zz'), []);
});

test('a chosen tag brings its closing tag, the caret between', () => {
    assert.deepEqual(tagInsert('mark'), { text: '<mark></mark>', caret: 6 });
    assert.deepEqual(tagInsert('br'), { text: '<br>', caret: 4 });
    const a = tagInsert('a');
    assert.equal(a.text, '<a href=""></a>');
    assert.equal(a.text[a.caret], '"');
    assert.equal(tagInsert('img').text, '<img src="">');
});

test('typing the > of an opening tag closes it', () => {
    assert.equal(closeOnGreater('<mark', 5), '</mark>');
    assert.equal(closeOnGreater('see <a href="x"', 15), '</a>');
    assert.equal(closeOnGreater('<br', 3), null);
    assert.equal(closeOnGreater('<mark></mark>', 5), null, 'already closed');
    assert.equal(closeOnGreater('1 < 2', 5), null);
    assert.equal(closeOnGreater('<notatag', 8), null);
});

test('matched inline tags render, stray and unknown ones stay text', () => {
    assert.ok(renderMarkdown('a <mark>hot</mark> b').includes('<mark>hot</mark>'));
    assert.ok(renderMarkdown('press <kbd>Ctrl</kbd>').includes('<kbd>Ctrl</kbd>'));
    assert.ok(renderMarkdown('H<sub>2</sub>O').includes('<sub>2</sub>'));
    assert.ok(!renderMarkdown('lone <u> here').includes('<u>'));
    assert.ok(!renderMarkdown('<script>alert(1)</script>').includes('<script>'));
    assert.ok(!renderMarkdown('<mark onclick="x">a</mark>').includes('<mark onclick'));
    assert.ok(renderMarkdown('`<mark>x</mark>`').includes('&lt;mark&gt;'));
});

test('a table renders with its header, alignment and inline markup', () => {
    const html = renderMarkdown('| Stack | Choice |\n| --- | ---: |\n| Framework | **React** |');
    assert.ok(html.includes('<th>Stack</th>'));
    assert.ok(html.includes('<th style="text-align:right">Choice</th>'));
    assert.ok(html.includes('<strong>React</strong>'));
    assert.ok(!renderMarkdown('| not | a table |').includes('<table'));
});

test('HTML tags are coloured in the editor without changing the text', () => {
    const [line] = highlightLines('a <mark>b</mark>');
    assert.match(line, /tok-tag">&lt;mark&gt;<\/span>/);
});

test('a mark with nothing to close it is coloured as a marker', () => {
    const [stars, two] = highlightLines('**\n2*3 and a ** b');
    assert.equal(stars, '<span class="tok-marker">**</span>');
    assert.match(two, /tok-marker">\*\*<\/span>/);
    assert.ok(!/tok-marker/.test(two.split(' and')[0]), '2*3 stays plain');
});

test('tags with an attribute are rebuilt safely', () => {
    const link = renderMarkdown('<a href="https://x.io/a">github</a>');
    assert.ok(link.includes('<span class="md-link" title="https://x.io/a">github</span>'));
    assert.ok(!link.includes('<a '));
    const empty = renderMarkdown('<a href="">github</a>');
    assert.ok(empty.includes('<span class="md-link">github</span>'), 'an empty href still shows its text');
    assert.ok(!renderMarkdown('<a href="javascript:alert(1)">x</a>').includes('javascript:'));
    assert.ok(renderMarkdown('<abbr title="HyperText">HTML</abbr>').includes('<abbr title="HyperText">HTML</abbr>'));
    assert.ok(renderMarkdown('<img src="https://x.io/p.png" alt="logo">').includes('>logo</span>'));
    assert.ok(!renderMarkdown('<a href="x" onclick="evil()">x</a>').includes('<a '));
});

test('a details block folds its Markdown body under its summary', () => {
    const html = renderMarkdown('<details>\n<summary>More</summary>\n\n- one\n- two\n</details>\nafter');
    assert.ok(html.includes('<details class="md-details"><summary>More</summary>'));
    assert.ok(html.includes('<li class="md-d0" data-n="1">one</li>'));
    assert.ok(html.includes('<p>after</p>'));
    assert.equal(renderMarkdown('<div>\ntext\n</div>'), '<p>text</p>', 'layout tags on their own line are dropped');
});

test('every heading level, list depth and quote depth has a class of its own', () => {
    const heads = highlightLines('#\n##\n###\n####\n#####\n######').map((h) => h.match(/tok-h(\d)/)[1]);
    assert.deepEqual(heads, ['1', '2', '3', '4', '5', '6']);
    const list = highlightLines('- a\n  - b\n    - c\n      - d\n        - e\n          - f');
    assert.deepEqual(list.map((l) => l.match(/tok-l(\d)/)[1]), ['0', '1', '2', '3', '4', '5'], 'six levels, each its own');
    assert.match(highlightLines('\t- tab')[0], /tok-l2/, 'a tab is two levels');
    const quotes = highlightLines('> a\n>> b\n>>> c').map((l) => l.match(/tok-q(\d)/)[1]);
    assert.deepEqual(quotes, ['0', '1', '2']);
});

test('the preview marks list depth, so the colours can follow it', () => {
    const html = renderMarkdown('- a\n  - b\n    - c');
    assert.ok(html.includes('md-d0') && html.includes('md-d1') && html.includes('md-d2'));
});

test('numbered items count per level and start again under each parent', () => {
    const html = renderMarkdown('1. a\n  1. x\n  2. y\n2. b\n  1. z');
    const numbers = [...html.matchAll(/data-n="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(numbers, ['1', 'a', 'b', '2', 'a'], 'digits, then letters under each parent');
});

test('each list level writes its numbers in its own style: 1. a. i. A. I. and round again', () => {
    const src = [0, 1, 2, 3, 4, 5].map((d) => `${'  '.repeat(d)}${d + 3}. item`).join('\n');
    const labels = [...renderMarkdown(src).matchAll(/data-n="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(labels, ['1', 'a', 'i', 'A', 'I', '1'], 'every level starts at its first number');
    const long = renderMarkdown('1. a\n2. b\n3. c\n4. d\n5. e\n  1. x\n  2. y\n  3. z\n  4. w');
    assert.ok(long.includes('data-n="5"') && long.includes('data-n="d"'));
    const roman = renderMarkdown(['1. a', '  1. b', '    1. c', '    2. d', '    3. e', '    4. f'].join('\n'));
    assert.ok(roman.includes('data-n="iv"'));
});