import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZE, LEVELS, emptyBoard, winLine, chooseMove, isFull } from '../src/js/games/caro.js';

const at = (row, col) => row * SIZE + col;

function board(stones) {
    const b = emptyBoard();
    for (const [row, col, player] of stones) b[at(row, col)] = player;
    return b;
}

test('five in a row wins in every direction, four does not', () => {
    for (const [dr, dc] of [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1],
    ]) {
        const stones = [0, 1, 2, 3, 4].map((i) => [5 + dr * i, 5 + dc * i, 1]);
        const b = board(stones);
        const line = winLine(b, at(5 + dr * 2, 5 + dc * 2));
        assert.equal(line?.length, 5, `direction ${dr},${dc}`);
        b[at(5 + dr * 4, 5 + dc * 4)] = 0;
        assert.equal(winLine(b, at(5 + dr * 2, 5 + dc * 2)), null);
    }
});

test('a run of six counts, and a gap or another colour breaks a run', () => {
    const six = board([0, 1, 2, 3, 4, 5].map((i) => [3, 2 + i, 2]));
    assert.equal(winLine(six, at(3, 4))?.length, 6);
    const broken = board([
        [3, 2, 1],
        [3, 3, 1],
        [3, 4, 2],
        [3, 5, 1],
        [3, 6, 1],
    ]);
    assert.equal(winLine(broken, at(3, 3)), null);
});

test('the first move is the centre, whatever the level', () => {
    for (const level of LEVELS) assert.equal(chooseMove(emptyBoard(), 1, level), at(7, 7));
});

test('every level takes a win in one', () => {
    const b = board([
        [7, 3, 1],
        [7, 4, 1],
        [7, 5, 1],
        [7, 6, 1],
        [6, 4, 2],
        [6, 5, 2],
        [8, 5, 2],
    ]);
    for (const level of LEVELS) {
        const move = chooseMove(b, 1, level, () => 0.99);
        assert.ok([at(7, 2), at(7, 7)].includes(move), `${level} played ${move}`);
    }
});

test('medium and hard stop an open four, easy usually does', () => {
    const b = board([
        [7, 3, 1],
        [7, 4, 1],
        [7, 5, 1],
        [7, 6, 1],
        [3, 3, 2],
        [10, 10, 2],
    ]);
    for (const level of ['medium', 'hard']) {
        assert.ok([at(7, 2), at(7, 7)].includes(chooseMove(b, 2, level)), level);
    }
    assert.ok([at(7, 2), at(7, 7)].includes(chooseMove(b, 2, 'easy', () => 0)));
});

test('hard answers an open three before it becomes a four', () => {
    // X has 7,5 7,6 7,7 open at both ends: O has to cap it at one end.
    const b = board([
        [7, 5, 1],
        [7, 6, 1],
        [7, 7, 1],
        [3, 3, 2],
        [11, 11, 2],
    ]);
    const move = chooseMove(b, 2, 'hard');
    assert.ok([at(7, 4), at(7, 8)].includes(move), `played ${move}`);
});

test('a bot always plays an empty cell', () => {
    const b = board([
        [7, 7, 1],
        [7, 8, 2],
        [8, 7, 1],
    ]);
    for (const level of LEVELS) {
        for (let i = 0; i < 20; i++) {
            const move = chooseMove(b, 2, level);
            assert.equal(b[move], 0, `${level} played onto a stone`);
        }
    }
    assert.equal(isFull(b), false);
});

test('hard stays quick enough to play', () => {
    const b = board([
        [7, 7, 1],
        [7, 8, 2],
        [8, 7, 1],
        [6, 6, 2],
        [8, 8, 1],
        [9, 9, 2],
        [6, 8, 1],
        [8, 6, 2],
    ]);
    const started = performance.now();
    chooseMove(b, 1, 'hard');
    assert.ok(performance.now() - started < 1500, 'under a second and a half');
});
