import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesFor } from '../src/js/screens/commands/games.js';

test('every game explains its goal, and how to play it', () => {
    for (const game of ['caro', 'xiangqi', 'go', 'chess']) {
        const html = rulesFor(game);
        assert.match(html, /<h4>Goal<\/h4>/, `${game} has no goal`);
        assert.ok(html.length > 300, `${game} says too little`);
        assert.ok(!html.includes('undefined'), `${game} has a hole in its text`);
    }
});

test('the rules are about the game they are for', () => {
    assert.match(rulesFor('caro'), /five or more/);
    assert.match(rulesFor('xiangqi'), /Cannon/);
    assert.match(rulesFor('xiangqi'), /river/);
    assert.match(rulesFor('chess'), /Castling/);
    assert.match(rulesFor('chess'), /En passant/);
    assert.match(rulesFor('go'), /liberties/i);
});