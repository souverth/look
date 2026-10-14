import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeContext, filterLanguages, filterWords, languageId } from '../src/js/screens/commands/note-code-assist.js';

test('after an opening fence the language being typed is found', () => {
    assert.deepEqual(codeContext('text\n```ty', 10), { kind: 'lang', from: 8, query: 'ty' });
    assert.deepEqual(codeContext('```', 3), { kind: 'lang', from: 3, query: '' });
    assert.equal(codeContext('```ts\ncode\n```', 14), null, 'a closing fence is not a language');
});

test('inside a block an identifier is a word, anything else is "inside"', () => {
    const text = '```ts\nconst total = 1;\nfunctio';
    const ctx = codeContext(text, text.length);
    assert.equal(ctx.kind, 'word');
    assert.equal(ctx.query, 'functio');
    assert.equal(ctx.lang, 'ts');
    assert.ok(ctx.block.includes('total'));
    assert.deepEqual(codeContext('```ts\nx = ', 10), { kind: 'inside', lang: 'ts' });
    assert.equal(codeContext('plain words here', 16), null, 'outside a block there is nothing to do');
    assert.equal(codeContext('```ts\nok\n```\nafter', 18), null, 'after the block closed');
});

test('languages: names, ids and aliases, prefixes first', () => {
    const ts = filterLanguages('type').map((l) => l.id);
    assert.ok(ts.includes('ts'));
    assert.equal(filterLanguages('py')[0].id, 'py');
    assert.ok(filterLanguages('c').some((l) => l.id === 'cpp'));
    assert.ok(filterLanguages('').length > 20, 'the bare fence offers the whole list');
    assert.deepEqual(filterLanguages('zzzz'), []);
    assert.equal(languageId('TypeScript'), 'ts');
    assert.equal(languageId('python3'), 'py');
    assert.equal(languageId('klingon'), 'klingon');
});

test('words: keywords of the language, then words already in the block', () => {
    const block = 'const totalPrice = 1;\nconst totalCount = 2;\ntot';
    const hits = filterWords({ query: 'tot', lang: 'ts', block });
    assert.deepEqual(hits.map((h) => h.word), ['totalPrice', 'totalCount'].sort((a, b) => a.length - b.length || a.localeCompare(b)));
    assert.ok(hits.every((h) => h.kind === 'text'));
    const kw = filterWords({ query: 'functio', lang: 'ts', block: 'functio' });
    assert.deepEqual(kw, [{ word: 'function', kind: 'keyword', starts: true }]);
    assert.ok(!filterWords({ query: 'const', lang: 'ts', block: '' }).some((h) => h.word === 'const'), 'a finished word is not offered again');
    assert.deepEqual(filterWords({ query: 'qq', lang: 'ts', block: 'qq' }), []);
});
