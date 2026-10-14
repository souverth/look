import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emojiContext, filterEmoji, emojiFor } from '../src/js/screens/commands/note-emoji.js';

test('a colon that starts a word opens the emoji list; times and URLs do not', () => {
    assert.deepEqual(emojiContext('nightly build is green :ta', 27), { from: 24, query: 'ta' });
    assert.deepEqual(emojiContext(':sm', 3), { from: 0, query: 'sm' });
    assert.equal(emojiContext('at 12:30', 8), null);
    assert.equal(emojiContext('see http://x', 12), null);
    assert.equal(emojiContext('a :s', 4), null, 'one letter is too early');
});

test('matches: the exact name, names starting with it, then names containing it', () => {
    const names = filterEmoji('ta').map((e) => e.name);
    assert.ok(names.indexOf('taco') < names.indexOf('star'), 'prefix before contains');
    assert.ok(names.includes('table_tennis_paddle_and_ball'));
    assert.equal(filterEmoji('tada')[0].name, 'tada');
    assert.equal(filterEmoji('tada')[0].char, '🎉');
    assert.equal(filterEmoji('smile')[0].char, '😄', 'a short name wins over the long official ones');
    assert.deepEqual(filterEmoji('qqqzzz'), []);
    assert.ok(filterEmoji('s').length <= 40);
});

test('a finished :name: finds its emoji', () => {
    assert.equal(emojiFor('rocket'), '🚀');
    assert.equal(emojiFor('+1'), '👍');
    assert.equal(emojiFor('ROCKET'), '🚀');
    assert.equal(emojiFor('nope_nope'), null);
});
