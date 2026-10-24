import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/js/markdown.js';
import { previewLineY, alignmentGoal, alignPreview } from '../src/js/screens/commands/note-preview-sync.js';

test('split source markers retain actual list lines after a fenced block', () => {
    const text = '# title\n\n```ts\nfunction a(){\n  return 0\n}\n```\n\n- a\n  - b\n  - c\n- dev\n- ';
    const html = renderMarkdown(text, 0, { sourceLines: true });
    assert.match(html, /<code data-source-line="3" data-source-code-lines="3"/);
    for (const line of [8, 9, 10, 11, 12]) {
        assert.match(html, new RegExp(`<li data-source-line="${line}"`));
    }
    assert.ok(!renderMarkdown(text).includes('data-source-line'), 'other Markdown consumers keep their markup');
});

test('opening an empty note clears alignment space from the previous note', () => {
    const removed = [];
    const preview = {
        getBoundingClientRect: () => ({ top: 0 }), querySelectorAll: () => [], scrollTop: 100,
        style: { removeProperty: (name) => removed.push(name) },
    };
    assert.equal(alignPreview(preview, { line: 0, top: 10 }, 150), 0);
    assert.equal(preview.scrollTop, 0);
    assert.deepEqual(removed, ['--preview-align-top', '--preview-align-room']);
});

test('source markers preserve offsets through paragraphs, quotes, details and table separators', () => {
    const text = 'one\ntwo\n\n> quoted\n> next\n\n<details open>\n<summary>More</summary>\ninside\n</details>\n\n| a |\n| - |\n| b |';
    const html = renderMarkdown(text, 10, { sourceLines: true });
    assert.match(html, /<span data-source-line="10">one/);
    assert.match(html, /<span data-source-line="11">two/);
    assert.match(html, /<span data-source-line="14">next/);
    assert.match(html, /<span data-source-line="18">inside/);
    assert.match(html, /<tr data-source-line="21">/);
    assert.match(html, /<tr data-source-line="23">/);
});

test('alignment uses matching source rows instead of the document scroll percentage', () => {
    const points = [{ line: 8, y: 240 }, { line: 9, y: 275 }, { line: 12, y: 380 }];
    assert.equal(previewLineY(points, 9), 275);
    assert.equal(previewLineY(points, 10), 310);
    assert.deepEqual(alignmentGoal(previewLineY(points, 12), 220), { scrollTop: 160, topSpace: 0 });
    assert.deepEqual(alignmentGoal(100, 220), { scrollTop: 0, topSpace: 120 });
    assert.equal(previewLineY([], 12), null);
    assert.equal(previewLineY(points, 99), 380);
});
