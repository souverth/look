import test from 'node:test';
import assert from 'node:assert/strict';
import {
    WHITE,
    BLACK,
    KNIGHT,
    QUEEN,
    LEVELS,
    Chess,
    perft,
    chooseMove,
    makeMove,
    moveFrom,
    moveTo,
    movePromo,
    squareOf,
    nameOf,
} from '../src/js/games/chess.js';

const sq = (name) => squareOf(8 - Number(name[1]), 'abcdefgh'.indexOf(name[0]));
const move = (g, from, to, promo = 0) => g.legalMoves().find((m) => moveFrom(m) === sq(from) && moveTo(m) === sq(to) && movePromo(m) === promo);

test('the starting position has the published perft counts', () => {
    const g = Chess.fromFen();
    assert.equal(perft(g, 1), 20);
    assert.equal(perft(g, 2), 400);
    assert.equal(perft(g, 3), 8902);
    assert.equal(perft(g, 4), 197281);
});

test('castling, en passant and promotion agree with the known counts', () => {
    // "Kiwipete": castling both ways, pins, en passant and promotions in a few plies.
    const kiwipete = Chess.fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    assert.equal(perft(kiwipete, 1), 48);
    assert.equal(perft(kiwipete, 2), 2039);
    assert.equal(perft(kiwipete, 3), 97862);
    // A rook ending full of en passant and checks.
    const ending = Chess.fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
    assert.equal(perft(ending, 1), 14);
    assert.equal(perft(ending, 2), 191);
    assert.equal(perft(ending, 3), 2812);
    assert.equal(perft(ending, 4), 43238);
    // Promotions and castling out of and into check.
    const promotions = Chess.fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
    assert.equal(perft(promotions, 1), 6);
    assert.equal(perft(promotions, 2), 264);
    assert.equal(perft(promotions, 3), 9467);
});

test('a move taken back leaves everything as it was', () => {
    const g = Chess.fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    const before = [g.positionKey(), g.halfmove, g.fullmove, g.wk, g.bk];
    for (const m of g.legalMoves()) {
        g.make(m);
        g.unmake();
        assert.deepEqual([g.positionKey(), g.halfmove, g.fullmove, g.wk, g.bk], before, `move ${nameOf(moveFrom(m))}${nameOf(moveTo(m))}`);
    }
});

test('you cannot castle through, out of or into check', () => {
    const open = Chess.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    assert.ok(move(open, 'e1', 'g1') && move(open, 'e1', 'c1'), 'both ways when nothing is in the way');
    const through = Chess.fromFen('r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1');
    assert.ok(!move(through, 'e1', 'g1'), 'not through f1 when a rook watches it');
    assert.ok(move(through, 'e1', 'c1'), 'the other side is fine');
    const inCheck = Chess.fromFen('r3k2r/8/8/8/8/4r3/8/R3K2R w KQkq - 0 1');
    assert.ok(!move(inCheck, 'e1', 'g1') && !move(inCheck, 'e1', 'c1'), 'not out of check');
    const noRights = Chess.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1');
    assert.ok(!move(noRights, 'e1', 'g1'), 'not once the right is gone');
});

test('en passant is only there for the move after the double step', () => {
    const g = Chess.fromFen('rnbqkbnr/pppp1ppp/8/8/3Pp3/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1');
    assert.ok(move(g, 'e4', 'd3'), 'black may take the pawn that has just passed');
    const after = Chess.fromFen('rnbqkbnr/pppp1ppp/8/8/3Pp3/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1');
    assert.ok(!move(after, 'e4', 'd3'), 'but not if it did not just move');
});

test('a pawn on the last rank can become any of four pieces', () => {
    const g = Chess.fromFen('8/P7/8/8/8/8/8/k6K w - - 0 1');
    const promos = g.legalMoves().filter((m) => moveFrom(m) === sq('a7')).map(movePromo).sort();
    assert.deepEqual(promos, [KNIGHT, 3, 4, QUEEN]);
});

test('checkmate, stalemate and the draws are told apart', () => {
    const fool = Chess.fromFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    assert.equal(fool.status().state, 'checkmate', "fool's mate");
    const stale = Chess.fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    assert.equal(stale.status().state, 'stalemate');
    const bare = Chess.fromFen('8/8/4k3/8/8/4K3/8/8 w - - 0 1');
    assert.equal(bare.status().state, 'draw');
    assert.match(bare.status().reason, /material/);
    const fifty = Chess.fromFen('8/8/4k3/8/8/4K3/8/R7 w - - 100 80');
    assert.equal(fifty.status().state, 'draw');
    assert.equal(Chess.fromFen().status().state, 'play');
});

test('the same position three times is a draw', () => {
    const g = Chess.fromFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    const shuffle = [move(g, 'a1', 'a2')];
    // Rook and king dance back and forth.
    const dance = [['a1', 'a2'], ['e8', 'd8'], ['a2', 'a1'], ['d8', 'e8']];
    for (let round = 0; round < 2; round++) {
        for (const [from, to] of dance) g.play(move(g, from, to));
    }
    assert.equal(g.status().state, 'draw');
    assert.match(g.status().reason, /three times/);
    assert.ok(shuffle[0]);
});

test('every level plays a legal move from the start and answers a reply', () => {
    for (const level of LEVELS) {
        const g = Chess.fromFen();
        const first = chooseMove(g, level);
        assert.ok(g.legalMoves().includes(first), `${level} opened with an illegal move`);
        g.play(first);
        const reply = chooseMove(g, level);
        assert.ok(g.legalMoves().includes(reply), `${level} replied with an illegal move`);
    }
});

test('the opening varies from game to game', () => {
    for (const level of LEVELS) {
        const firsts = new Set();
        const replies = new Set();
        for (let i = 0; i < 16; i++) {
            const g = Chess.fromFen();
            firsts.add(chooseMove(g, level, () => i / 16));
            g.play(g.legalMoves().find((m) => moveFrom(m) === sq('e2') && moveTo(m) === sq('e4')));
            replies.add(chooseMove(g, level, () => i / 16));
        }
        assert.ok(firsts.size >= 3, `${level} opened ${firsts.size} ways`);
        assert.ok(replies.size >= 3, `${level} replied ${replies.size} ways`);
    }
});

test('medium and hard take a free queen, and hard finds a mate in one', () => {
    const free = Chess.fromFen('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1');
    const take = makeMove(sq('d1'), sq('d5'));
    for (const level of ['medium', 'hard']) assert.equal(chooseMove(free, level), take, level);
    const mate = Chess.fromFen('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    const move1 = chooseMove(mate, 'hard');
    mate.play(move1);
    assert.equal(mate.status().state, 'checkmate', `played ${nameOf(moveFrom(move1))}${nameOf(moveTo(move1))}`);
});

test('hard keeps to its time', () => {
    const g = Chess.fromFen('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
    const started = performance.now();
    chooseMove(g, 'hard');
    assert.ok(performance.now() - started < 2800, 'about two seconds at most');
    assert.equal(g.turn, WHITE);
    assert.ok(BLACK === -1);
});
