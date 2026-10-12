import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseQuickCapture,
    splitNoteTags,
    quickResultId,
    classifyResultId,
    isSyntheticResultId,
    isCommandSuggestionQuery,
    commandSuggestionResults,
} from '../src/js/catalog.js';

test(':note and :todo need a space and become captures', () => {
    assert.deepEqual(parseQuickCapture(':note buy milk'), { action: 'note', text: 'buy milk' });
    assert.deepEqual(parseQuickCapture(':todo call the dentist'), {
        action: 'task',
        text: 'call the dentist',
    });
    assert.deepEqual(parseQuickCapture('  :NOTE   padded  '), { action: 'note', text: 'padded' });
});

test('a bare :note or :todo stays the discovery menu', () => {
    assert.equal(parseQuickCapture(':note'), null);
    assert.equal(parseQuickCapture(':todo'), null);
    assert.equal(isCommandSuggestionQuery(':note'), true);
});

test(':done is a capture with or without a filter', () => {
    assert.deepEqual(parseQuickCapture(':done'), { action: 'done', text: '' });
    assert.deepEqual(parseQuickCapture(':done dentist'), { action: 'done', text: 'dentist' });
});

test('look-alikes and ordinary queries are not captures', () => {
    for (const q of [':notebook', ':notes x', ':calc 2+2', 'note buy milk', ':', '', ':donee']) {
        assert.equal(parseQuickCapture(q), null, JSON.stringify(q));
    }
});

test('a capture is not an inline command that opens its panel', () => {
    // `:note x` used to jump into /note with "x" prefilled; it now stays in the
    // search box, so it must still be a command-suggestion query.
    assert.equal(isCommandSuggestionQuery(':note buy milk'), true);
    assert.equal(isCommandSuggestionQuery(':calc 2+2'), false);
});

test('hashtags become tags and leave the text', () => {
    assert.deepEqual(splitNoteTags('buy milk #errands #home'), {
        body: 'buy milk',
        tags: ['errands', 'home'],
    });
    assert.deepEqual(splitNoteTags('#idea #Idea shower thought'), {
        body: 'shower thought',
        tags: ['idea'],
    });
    // A # inside a word, or a bare #, is just text.
    assert.deepEqual(splitNoteTags('issue#42 and C# are fine #'), {
        body: 'issue#42 and C# are fine #',
        tags: [],
    });
    assert.deepEqual(splitNoteTags('#only'), { body: '', tags: ['only'] });
});

test('tags are capped at eight', () => {
    const text = Array.from({ length: 12 }, (_, i) => `#t${i}`).join(' ');
    assert.equal(splitNoteTags(text).tags.length, 8);
});

test('quick row ids round-trip, payload colons included', () => {
    const id = quickResultId('note', 'meet at 10:30: room 2');
    assert.deepEqual(classifyResultId(id), {
        kind: 'quick',
        action: 'note',
        payload: 'meet at 10:30: room 2',
    });
    assert.equal(isSyntheticResultId(id), true);
});

test('the : menu advertises the three captures, narrowed by what is typed', () => {
    const all = commandSuggestionResults(':').map((r) => r.title);
    assert.ok(all.includes(':note <text>') && all.includes(':todo <text>') && all.includes(':done'));
    const some = commandSuggestionResults(':done').map((r) => r.title);
    assert.ok(some.includes(':done') && !some.includes(':note <text>'));
});
