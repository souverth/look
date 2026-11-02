import test from 'node:test';
import assert from 'node:assert/strict';
import { noteLabel, ageLabel, newestFirst } from '../src/js/deck-format.js';

test('a note is named by its title, else its first line, else a placeholder', () => {
    assert.equal(noteLabel({ title: '  Shopping ', body: 'milk' }), 'Shopping');
    assert.equal(noteLabel({ title: '', body: '\n\n## Plan\nmore' }), 'Plan');
    assert.equal(noteLabel({ title: '', body: '- [ ] call the dentist' }), 'call the dentist');
    assert.equal(noteLabel({ title: '', body: '> quoted' }), 'quoted');
    assert.equal(noteLabel({ title: '', body: '   \n ' }), 'Untitled');
    assert.equal(noteLabel(null), 'Untitled');
});

test('age is shown in the fewest characters', () => {
    const now = 1_000_000;
    assert.equal(ageLabel(now - 5, now), 'now');
    assert.equal(ageLabel(now - 5 * 60, now), '5m');
    assert.equal(ageLabel(now - 3 * 3600, now), '3h');
    assert.equal(ageLabel(now - 2 * 86400, now), '2d');
    assert.equal(ageLabel(now - 21 * 86400, now), '3w');
    assert.equal(ageLabel(now + 100, now), 'now', 'a clock a little ahead is not negative');
});

test('notes sort newest first', () => {
    const sorted = [{ updated_at_unix_s: 1 }, { updated_at_unix_s: 9 }, {}].sort(newestFirst);
    assert.deepEqual(
        sorted.map((n) => n.updated_at_unix_s ?? 0),
        [9, 1, 0],
    );
});
