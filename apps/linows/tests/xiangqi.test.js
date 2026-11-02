import test from 'node:test';
import assert from 'node:assert/strict';
import {
    RED,
    BLACK,
    KING,
    ADVISOR,
    HORSE,
    CHARIOT,
    CANNON,
    PAWN,
    ELEPHANT,
    LEVELS,
    initialBoard,
    legalMoves,
    legalMovesFrom,
    perft,
    inCheck,
    status,
    chooseMove,
    applyMove,
    undoMove,
    makeMove,
    moveFrom,
    moveTo,
} from '../src/js/games/xiangqi.js';

const at = (row, col) => row * 9 + col;

/** A board from `[row, col, piece]` triples. */
function board(pieces) {
    const b = new Int8Array(90);
    for (const [row, col, piece] of pieces) b[at(row, col)] = piece;
    return b;
}

test('the opening position has the known number of moves at each depth', () => {
    const b = initialBoard();
    // Published perft figures for the standard start.
    assert.equal(perft(b, RED, 1), 44);
    assert.equal(perft(b, RED, 2), 1920);
    assert.equal(perft(b, RED, 3), 79666);
});

test('a move can be taken back and leaves the board as it was', () => {
    const b = initialBoard();
    const before = b.slice();
    const move = legalMoves(b, RED)[0];
    const captured = applyMove(b, move);
    assert.notDeepEqual(b, before);
    undoMove(b, move, captured);
    assert.deepEqual(b, before);
});

test('the horse is blocked by a piece on its leg', () => {
    const open = board([
        [9, 4, KING],
        [0, 3, -KING],
        [5, 4, HORSE],
    ]);
    assert.equal(legalMovesFrom(open, RED, at(5, 4)).length, 8);
    const hobbled = board([
        [9, 4, KING],
        [0, 3, -KING],
        [5, 4, HORSE],
        [4, 4, PAWN], // on the leg for the two jumps going up
    ]);
    assert.equal(legalMovesFrom(hobbled, RED, at(5, 4)).length, 6);
});

test('the elephant cannot cross the river and is blocked at its eye', () => {
    const b = board([
        [9, 4, KING],
        [0, 3, -KING],
        [5, 2, ELEPHANT],
    ]);
    const to = legalMovesFrom(b, RED, at(5, 2)).sort((a, c) => a - c);
    assert.deepEqual(to, [at(7, 0), at(7, 4)], 'only back across its own half');
    b[at(6, 3)] = PAWN;
    assert.deepEqual(legalMovesFrom(b, RED, at(5, 2)), [at(7, 0)], 'the eye at 6,3 is blocked');
});

test('the cannon takes by jumping exactly one piece', () => {
    const b = board([
        [9, 4, KING],
        [0, 3, -KING],
        [5, 0, CANNON],
        [5, 3, PAWN], // the screen
        [5, 6, -PAWN],
        [5, 8, -CHARIOT],
    ]);
    const to = legalMovesFrom(b, RED, at(5, 0));
    assert.ok(to.includes(at(5, 6)), 'captures the first piece beyond the screen');
    assert.ok(!to.includes(at(5, 8)), 'not the second');
    assert.ok(!to.includes(at(5, 3)), 'and never its own screen');
    assert.ok(to.includes(at(5, 2)), 'it moves like a chariot when it does not capture');
});

test('a pawn goes sideways only after the river, and never back', () => {
    const before = board([
        [9, 4, KING],
        [0, 3, -KING],
        [6, 0, PAWN],
    ]);
    assert.deepEqual(legalMovesFrom(before, RED, at(6, 0)), [at(5, 0)]);
    const after = board([
        [9, 4, KING],
        [0, 3, -KING],
        [4, 4, PAWN],
    ]);
    assert.deepEqual(legalMovesFrom(after, RED, at(4, 4)).sort((a, b) => a - b), [at(3, 4), at(4, 3), at(4, 5)]);
});

test('the kings may not face each other on an open file', () => {
    const b = board([
        [9, 4, KING],
        [0, 4, -KING],
        [5, 4, CHARIOT],
    ]);
    // The chariot is the only thing between them, so it must stay on the file.
    const moves = legalMovesFrom(b, RED, at(5, 4));
    assert.ok(moves.every((to) => to % 9 === 4), 'it can only slide along the file');
    assert.ok(inCheck(board([[9, 4, KING], [0, 4, -KING]]), RED), 'with nothing between, it is check');
});

test('check is seen from every attacker', () => {
    const kingsApart = [
        [9, 3, KING],
        [0, 5, -KING],
    ];
    assert.ok(inCheck(board([...kingsApart, [5, 3, -CHARIOT]]), RED), 'chariot');
    assert.ok(inCheck(board([...kingsApart, [5, 3, -CANNON], [7, 3, ADVISOR]]), RED), 'cannon over a screen');
    assert.ok(!inCheck(board([...kingsApart, [5, 3, -CANNON]]), RED), 'a cannon with no screen does not');
    assert.ok(inCheck(board([...kingsApart, [7, 4, -HORSE]]), RED), 'horse');
    assert.ok(!inCheck(board([...kingsApart, [7, 4, -HORSE], [8, 4, PAWN]]), RED), 'horse with its leg blocked');
    assert.ok(inCheck(board([...kingsApart, [8, 3, -PAWN]]), RED), 'pawn in front');
    assert.ok(inCheck(board([...kingsApart, [9, 2, -PAWN]]), RED), 'a pawn that has crossed also takes sideways');
    assert.ok(!inCheck(board([...kingsApart, [9, 3 - 1, PAWN]]), RED), 'its own pawn is no threat');
    assert.ok(!inCheck(board([...kingsApart, [7, 3, -PAWN]]), RED), 'a pawn two ahead is not yet a threat');
});

test('a mated side has no moves and the status says so', () => {
    // Red king boxed in its palace corner by a chariot and a cannon.
    const b = board([
        [9, 3, KING],
        [0, 4, -KING],
        [9, 0, -CHARIOT],
        [8, 0, -CHARIOT],
    ]);
    const s = status(b, RED);
    assert.equal(s.state, 'checkmate');
    assert.equal(s.moves.length, 0);
    assert.equal(status(initialBoard(), RED).state, 'play');
});

test('every level plays a legal move from the opening', () => {
    for (const level of LEVELS) {
        const b = initialBoard();
        const move = chooseMove(b, RED, level);
        const legal = legalMoves(b, RED);
        assert.ok(legal.includes(move), `${level} played an illegal move`);
    }
});

test('medium and hard take a free chariot, easy sometimes does', () => {
    const b = board([
        [9, 3, KING],
        [0, 5, -KING],
        [5, 0, CHARIOT],
        [5, 6, -CHARIOT], // undefended, on the chariot's rank
        [8, 8, PAWN],
    ]);
    const take = makeMove(at(5, 0), at(5, 6));
    for (const level of ['medium', 'hard']) {
        assert.equal(chooseMove(b, RED, level), take, level);
    }
    assert.equal(chooseMove(b, RED, 'easy', () => 0), take);
});

test('hard finds a win in one', () => {
    // Black king boxed on its palace edge. Leaving it with no move wins in xiangqi,
    // whether or not it is in check, so either ending counts.
    const b = board([
        [9, 3, KING],
        [0, 4, -KING],
        [2, 0, CHARIOT],
        [1, 3, CHARIOT],
    ]);
    const move = chooseMove(b, RED, 'hard');
    const captured = applyMove(b, move);
    const result = status(b, BLACK);
    undoMove(b, move, captured);
    assert.ok(
        ['checkmate', 'stalemate'].includes(result.state),
        `played ${moveFrom(move)} to ${moveTo(move)}: ${result.state}`,
    );
});

test('hard answers within its time', () => {
    const b = initialBoard();
    const started = performance.now();
    chooseMove(b, RED, 'hard');
    assert.ok(performance.now() - started < 2600, 'about two seconds at most');
});
