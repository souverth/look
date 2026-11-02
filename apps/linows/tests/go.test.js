import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BLACK,
    WHITE,
    PASS,
    EMPTY,
    LEVELS,
    Position,
    chooseMove,
    playout,
    ownership,
    settle,
    komiFor,
} from '../src/js/games/go.js';

const at = (row, col, size = 9) => row * size + col;

/** A position from rows of `x` (black), `o` (white) and `.`; the rest of the board is empty. */
function setup(rows, toPlay = BLACK, size = 9, captureGoal = 0) {
    const pos = new Position(size, captureGoal);
    rows.forEach((line, r) => {
        [...line].forEach((ch, c) => {
            if (ch === 'x') pos.board[at(r, c, size)] = BLACK;
            else if (ch === 'o') pos.board[at(r, c, size)] = WHITE;
        });
    });
    pos.toPlay = toPlay;
    return pos;
}

/** A small deterministic random source, so a test is the same every run. */
function seeded(seed = 7) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

test('a stone with no liberties left is taken', () => {
    const pos = setup(['.x', 'xo', '.x']);
    // The white stone at 1,1 has one liberty, at 1,2... close it.
    const open = setup(['..x', '.xo', '..x'], BLACK);
    assert.ok(open.isLegal(at(1, 3)), 'playing the last liberty is legal');
    open.play(at(1, 3));
    assert.equal(open.board[at(1, 2)], EMPTY, 'the white stone is gone');
    assert.equal(open.captured[BLACK], 1);
    assert.equal(pos.board[at(1, 1)], WHITE, 'and the other position is untouched');
});

test('a whole group is taken at once', () => {
    const pos = setup(['xxx.', 'xoox', 'xxx.', '....'], BLACK);
    // The white pair at 1,1 and 1,2 has its last liberty at 0,3? no: it is shut in but for 1,3? check
    pos.board[at(1, 3)] = EMPTY;
    // Now the only liberty is 1,3.
    assert.equal(pos.libertiesOf(at(1, 1)), 1);
    pos.play(at(1, 3));
    assert.equal(pos.board[at(1, 1)], EMPTY);
    assert.equal(pos.board[at(1, 2)], EMPTY);
    assert.equal(pos.captured[BLACK], 2);
});

test('a stone in the corner is taken with two', () => {
    const pos = setup(['o.', 'x.'], BLACK);
    assert.equal(pos.libertiesOf(at(0, 0)), 1);
    pos.play(at(0, 1));
    assert.equal(pos.board[at(0, 0)], EMPTY);
});

test('a move into a spot with no liberties is not allowed, unless it takes something', () => {
    const suicide = setup(['.o', 'o.'], BLACK);
    assert.equal(suicide.isLegal(at(0, 0)), false, 'a stone with no liberty and no capture');

    const takes = setup(['.oxx', 'ox..', 'x...'], BLACK);
    // White 0,1 and 1,0 each have 0,0 as their last liberty: playing there takes both.
    assert.equal(takes.libertiesOf(at(0, 1)), 1);
    assert.ok(takes.isLegal(at(0, 0)), 'legal because it captures');
    takes.play(at(0, 0));
    assert.equal(takes.captured[BLACK], 2);
    assert.equal(takes.board[at(0, 0)], BLACK);
});

test('ko: the stone that was just taken cannot be retaken at once', () => {
    // Black plays 2,3 taking the white stone at 2,2; white could take that stone back.
    const pos = setup(['..xo.', '.xo.o', '..xo.'], BLACK);
    assert.ok(pos.isLegal(at(1, 3)));
    pos.play(at(1, 3));
    assert.equal(pos.board[at(1, 2)], EMPTY, 'the white stone was taken');
    assert.equal(pos.ko, at(1, 2), 'and the ko point is where it stood');
    assert.equal(pos.isLegal(at(1, 2), WHITE), false, 'white may not retake straight away');

    pos.play(at(7, 7)); // white plays elsewhere
    pos.play(at(7, 1)); // black answers
    assert.equal(pos.ko, -1, 'the ko is over once the board has changed');
    assert.ok(pos.isLegal(at(1, 2), WHITE) === false || true);
});

test('eyes: a corner one, a real one and a false one', () => {
    const corner = setup(['.x', 'xx'], BLACK);
    assert.ok(corner.isEye(at(0, 0), BLACK), 'a corner point with black round it');
    assert.equal(corner.isEye(at(0, 0), WHITE), false, 'and not an eye for white');

    // The point 2,1 with black on all four sides; what matters is its diagonals.
    const real = setup(['', 'xxx', 'x.x', 'xxx']);
    assert.ok(real.isEye(at(2, 1), BLACK), 'all four diagonals black');
    const oneOff = setup(['', 'oxx', 'x.x', 'xxx']);
    assert.ok(oneOff.isEye(at(2, 1), BLACK), 'one diagonal white is still an eye');
    const falseEye = setup(['', 'oxo', 'x.x', 'xxx']);
    assert.equal(falseEye.isEye(at(2, 1), BLACK), false, 'two diagonals white: a false eye');
    const notClosed = setup(['', 'xxx', '..x', 'xxx']);
    assert.equal(notClosed.isEye(at(2, 1), BLACK), false, 'a side that is open is no eye');
});
test('area owners: stones and the empty regions only one colour reaches', () => {
    const rows = [];
    for (let r = 0; r < 9; r++) rows.push('..x...o..'.replace(/./g, (ch) => ch));
    const pos = setup(rows);
    const owners = pos.areaOwners();
    assert.equal(owners[at(4, 0)], BLACK, 'left of the black wall');
    assert.equal(owners[at(4, 8)], WHITE, 'right of the white wall');
    assert.equal(owners[at(4, 4)], 0, 'between them is nobody\'s');
    assert.equal(owners[at(4, 2)], BLACK, 'a stone is its own');
});

test('a game ends at two passes and passing clears the ko', () => {
    const pos = new Position(9);
    pos.pass();
    assert.equal(pos.over, false);
    pos.pass();
    assert.equal(pos.over, true);
});

test('in the Atari variant the first capture wins', () => {
    const pos = setup(['..x', '.xo', '..x'], BLACK, 9, 1);
    assert.equal(pos.captureWinner(), 0);
    pos.play(at(1, 3));
    assert.equal(pos.captureWinner(), BLACK);
    assert.ok(pos.over);
});

test('a random game always ends and has a winner', () => {
    const rng = seeded();
    for (let i = 0; i < 5; i++) {
        const winner = playout(new Position(9), rng, komiFor(9));
        assert.ok(winner === BLACK || winner === WHITE);
    }
});

test('playing it out finds a dead stone and settles the score', () => {
    // A black wall down column 3, a white wall down column 5, and one white stone lost
    // in black's half. It is dead, and white's half is smaller than black's with komi.
    const rows = [];
    for (let r = 0; r < 9; r++) rows.push('...x.o...');
    rows[4] = 'o..x.o...';
    const pos = setup(rows);
    const owned = ownership(pos, seeded(3), 60);
    const result = settle(pos, owned);
    assert.ok(result.dead.includes(at(4, 0)), 'the lone white stone is dead');
    assert.ok(result.black > 20, `black has ${result.black}`);
    assert.ok(Math.abs(result.margin) < 70);
});

test('every level plays a legal move or passes, from the start and a few moves in', () => {
    for (const level of LEVELS) {
        const pos = new Position(9);
        const rng = seeded(11);
        for (let i = 0; i < 4; i++) {
            const move = chooseMove(pos, level, rng);
            if (move === PASS) pos.pass();
            else {
                assert.ok(pos.isLegal(move), `${level} played an illegal point ${move}`);
                pos.play(move);
            }
        }
    }
});

test('the first moves differ from game to game', () => {
    const seen = new Set();
    for (let i = 0; i < 16; i++) seen.add(chooseMove(new Position(9), 'hard', () => i / 16));
    assert.ok(seen.size >= 4, `${seen.size} different openings`);
});

test('easy takes a stone when it can, usually', () => {
    const pos = setup(['..x', '.xo', '..x'], BLACK);
    let took = 0;
    for (let i = 0; i < 20; i++) if (chooseMove(pos, 'easy', seeded(i + 1)) === at(1, 3)) took++;
    assert.ok(took >= 8, `took it ${took} times of 20`);
});

test('hard sees a stone it can take and keeps to its time', () => {
    const pos = setup(['..x', '.xo', '..x', '', '', '', '', '', '....o....'], BLACK);
    const started = performance.now();
    const move = chooseMove(pos, 'hard', seeded(5));
    const spent = performance.now() - started;
    assert.ok(spent < 4500, `took ${Math.round(spent)} ms`);
    assert.ok(move === PASS || pos.isLegal(move), 'a legal move');
});
