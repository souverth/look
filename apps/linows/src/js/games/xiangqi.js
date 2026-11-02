// Xiangqi (cờ tướng): the rules, and the bots that play it. Pure, so it runs under
// node and the panel only draws what this decides.
//
// The board is 90 cells, `row * 9 + col`, row 0 at the top. Red sits at the bottom
// and moves first; black is at the top. A piece is a signed number: positive red,
// negative black, the size saying what it is.
//
// Rules left out: perpetual check and repetition are not judged, and there is no
// draw by a count of quiet moves.

export const COLS = 9;
export const ROWS = 10;
export const RED = 1;
export const BLACK = -1;
export const LEVELS = ['easy', 'medium', 'hard'];

export const KING = 1;
export const ADVISOR = 2;
export const ELEPHANT = 3;
export const HORSE = 4;
export const CHARIOT = 5;
export const CANNON = 6;
export const PAWN = 7;

/** What to draw for a piece: the character each side writes on it. */
export const PIECE_CHARS = {
    [RED]: { [KING]: '帥', [ADVISOR]: '仕', [ELEPHANT]: '相', [HORSE]: '傌', [CHARIOT]: '俥', [CANNON]: '炮', [PAWN]: '兵' },
    [BLACK]: { [KING]: '將', [ADVISOR]: '士', [ELEPHANT]: '象', [HORSE]: '馬', [CHARIOT]: '車', [CANNON]: '砲', [PAWN]: '卒' },
};

const ROW = new Int8Array(90);
const COL = new Int8Array(90);
for (let i = 0; i < 90; i++) {
    ROW[i] = Math.floor(i / COLS);
    COL[i] = i % COLS;
}
export const rowOf = (idx) => ROW[idx];
export const colOf = (idx) => COL[idx];
const idxOf = (row, col) => row * COLS + col;
const inBoard = (row, col) => row >= 0 && row < ROWS && col >= 0 && col < COLS;

/** A move is `from << 7 | to`. */
export const makeMove = (from, to) => (from << 7) | to;
export const moveFrom = (m) => m >> 7;
export const moveTo = (m) => m & 127;

export const sideOf = (piece) => (piece > 0 ? RED : piece < 0 ? BLACK : 0);
export const kindOf = (piece) => Math.abs(piece);

export function initialBoard() {
    const board = new Int8Array(90);
    const back = [CHARIOT, HORSE, ELEPHANT, ADVISOR, KING, ADVISOR, ELEPHANT, HORSE, CHARIOT];
    for (let c = 0; c < COLS; c++) {
        board[idxOf(0, c)] = -back[c];
        board[idxOf(9, c)] = back[c];
    }
    for (const c of [1, 7]) {
        board[idxOf(2, c)] = -CANNON;
        board[idxOf(7, c)] = CANNON;
    }
    for (const c of [0, 2, 4, 6, 8]) {
        board[idxOf(3, c)] = -PAWN;
        board[idxOf(6, c)] = PAWN;
    }
    return board;
}

// --- Where a piece may stand and go -------------------------------------------

const inPalace = (side, row, col) =>
    col >= 3 && col <= 5 && (side === RED ? row >= 7 && row <= 9 : row >= 0 && row <= 2);
const ownHalf = (side, row) => (side === RED ? row >= 5 : row <= 4);
const crossed = (side, row) => (side === RED ? row <= 4 : row >= 5);
const forward = (side) => (side === RED ? -1 : 1);

const ORTHO = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
];
const DIAG = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
];
const HORSE_JUMPS = [
    [-2, -1],
    [-2, 1],
    [2, -1],
    [2, 1],
    [-1, -2],
    [1, -2],
    [-1, 2],
    [1, 2],
];

/** Every move a piece could make ignoring whether it leaves its own king in check. */
function pieceMoves(board, from, out) {
    const piece = board[from];
    const side = sideOf(piece);
    const row = ROW[from];
    const col = COL[from];
    const free = (to) => sideOf(board[to]) !== side;

    switch (kindOf(piece)) {
        case KING:
            for (const [dr, dc] of ORTHO) {
                const r = row + dr;
                const c = col + dc;
                if (inPalace(side, r, c) && free(idxOf(r, c))) out.push(makeMove(from, idxOf(r, c)));
            }
            break;
        case ADVISOR:
            for (const [dr, dc] of DIAG) {
                const r = row + dr;
                const c = col + dc;
                if (inPalace(side, r, c) && free(idxOf(r, c))) out.push(makeMove(from, idxOf(r, c)));
            }
            break;
        case ELEPHANT:
            for (const [dr, dc] of DIAG) {
                const r = row + dr * 2;
                const c = col + dc * 2;
                if (inBoard(r, c) && ownHalf(side, r) && !board[idxOf(row + dr, col + dc)] && free(idxOf(r, c))) {
                    out.push(makeMove(from, idxOf(r, c)));
                }
            }
            break;
        case HORSE:
            for (const [dr, dc] of HORSE_JUMPS) {
                const r = row + dr;
                const c = col + dc;
                if (!inBoard(r, c)) continue;
                // The leg: the step toward the long side, which a piece can block.
                const leg = Math.abs(dr) === 2 ? idxOf(row + dr / 2, col) : idxOf(row, col + dc / 2);
                if (!board[leg] && free(idxOf(r, c))) out.push(makeMove(from, idxOf(r, c)));
            }
            break;
        case CHARIOT:
            for (const [dr, dc] of ORTHO) {
                let r = row + dr;
                let c = col + dc;
                while (inBoard(r, c)) {
                    const to = idxOf(r, c);
                    if (!board[to]) out.push(makeMove(from, to));
                    else {
                        if (sideOf(board[to]) !== side) out.push(makeMove(from, to));
                        break;
                    }
                    r += dr;
                    c += dc;
                }
            }
            break;
        case CANNON:
            for (const [dr, dc] of ORTHO) {
                let r = row + dr;
                let c = col + dc;
                while (inBoard(r, c) && !board[idxOf(r, c)]) {
                    out.push(makeMove(from, idxOf(r, c)));
                    r += dr;
                    c += dc;
                }
                // The first piece is the screen; it takes the next one beyond it.
                r += dr;
                c += dc;
                while (inBoard(r, c)) {
                    const to = idxOf(r, c);
                    if (board[to]) {
                        if (sideOf(board[to]) !== side) out.push(makeMove(from, to));
                        break;
                    }
                    r += dr;
                    c += dc;
                }
            }
            break;
        case PAWN: {
            const ahead = row + forward(side);
            if (inBoard(ahead, col) && free(idxOf(ahead, col))) out.push(makeMove(from, idxOf(ahead, col)));
            if (crossed(side, row)) {
                for (const dc of [-1, 1]) {
                    if (inBoard(row, col + dc) && free(idxOf(row, col + dc))) out.push(makeMove(from, idxOf(row, col + dc)));
                }
            }
            break;
        }
        default:
    }
}

export function applyMove(board, move) {
    const from = move >> 7;
    const to = move & 127;
    const captured = board[to];
    board[to] = board[from];
    board[from] = 0;
    return captured;
}

export function undoMove(board, move, captured) {
    const from = move >> 7;
    const to = move & 127;
    board[from] = board[to];
    board[to] = captured;
}

// --- Check -----------------------------------------------------------------------

function kingSquare(board, side) {
    const target = side * KING;
    const rows = side === RED ? [7, 8, 9] : [0, 1, 2];
    for (const r of rows) {
        for (let c = 3; c <= 5; c++) if (board[idxOf(r, c)] === target) return idxOf(r, c);
    }
    return -1;
}

/** True when `side`'s king is attacked, counting the two kings facing each other down a file. */
export function inCheck(board, side) {
    const k = kingSquare(board, side);
    if (k < 0) return true; // taken: only the search can see this
    const row = ROW[k];
    const col = COL[k];
    const foe = -side;

    for (const [dr, dc] of ORTHO) {
        let r = row + dr;
        let c = col + dc;
        let first = 0;
        while (inBoard(r, c) && !(first = board[idxOf(r, c)])) {
            r += dr;
            c += dc;
        }
        if (!first) continue;
        // A chariot, or the other king down an open file.
        if (first === foe * CHARIOT) return true;
        if (first === foe * KING && dc === 0) return true;
        // A cannon with this piece as its screen.
        r += dr;
        c += dc;
        while (inBoard(r, c)) {
            const p = board[idxOf(r, c)];
            if (p) {
                if (p === foe * CANNON) return true;
                break;
            }
            r += dr;
            c += dc;
        }
    }

    for (const [dr, dc] of HORSE_JUMPS) {
        const pr = row - dr;
        const pc = col - dc;
        if (!inBoard(pr, pc) || board[idxOf(pr, pc)] !== foe * HORSE) continue;
        const leg = Math.abs(dr) === 2 ? idxOf(pr + dr / 2, pc) : idxOf(pr, pc + dc / 2);
        if (!board[leg]) return true;
    }

    // A pawn in front of the king (from the foe's side), or beside it once across.
    const foeAhead = forward(foe);
    const pawn = foe * PAWN;
    if (inBoard(row - foeAhead, col) && board[idxOf(row - foeAhead, col)] === pawn) return true;
    for (const dc of [-1, 1]) {
        if (inBoard(row, col + dc) && board[idxOf(row, col + dc)] === pawn && crossed(foe, row)) return true;
    }
    return false;
}

// --- Legal moves -----------------------------------------------------------------

/** Moves for `side` that leave its own king safe. */
export function legalMoves(board, side) {
    const pseudo = [];
    for (let i = 0; i < 90; i++) if (sideOf(board[i]) === side) pieceMoves(board, i, pseudo);
    const legal = [];
    for (const move of pseudo) {
        const captured = applyMove(board, move);
        if (!inCheck(board, side)) legal.push(move);
        undoMove(board, move, captured);
    }
    return legal;
}

/** The squares the piece on `from` may go to. */
export function legalMovesFrom(board, side, from) {
    return legalMoves(board, side)
        .filter((m) => moveFrom(m) === from)
        .map(moveTo);
}

/** `check` and `play` carry on; `checkmate` and `stalemate` are both a loss for `side` in xiangqi. */
export function status(board, side) {
    const moves = legalMoves(board, side);
    const check = inCheck(board, side);
    if (moves.length === 0) return { state: check ? 'checkmate' : 'stalemate', check, moves };
    return { state: check ? 'check' : 'play', check, moves };
}

export function perft(board, side, depth) {
    if (depth === 0) return 1;
    let total = 0;
    for (const move of legalMoves(board, side)) {
        const captured = applyMove(board, move);
        total += perft(board, -side, depth - 1);
        undoMove(board, move, captured);
    }
    return total;
}

// --- Judging a position --------------------------------------------------------

const VALUE = { [KING]: 10000, [ADVISOR]: 200, [ELEPHANT]: 200, [HORSE]: 420, [CHARIOT]: 900, [CANNON]: 450, [PAWN]: 100 };

/** Red's lead in centipawns: material, with a little for where a piece stands. */
function evaluate(board) {
    let total = 0;
    for (let i = 0; i < 90; i++) {
        const piece = board[i];
        if (!piece) continue;
        const side = sideOf(piece);
        const kind = kindOf(piece);
        const row = ROW[i];
        const col = COL[i];
        let value = VALUE[kind];
        const centre = 4 - Math.abs(col - 4);
        switch (kind) {
            case PAWN:
                if (crossed(side, row)) {
                    value += 100 + (side === RED ? 4 - row : row - 5) * 6 + centre * 3;
                }
                break;
            case HORSE:
                value += centre * 5 + (row > 0 && row < 9 ? 6 : 0);
                break;
            case CANNON:
                value += centre * 3;
                break;
            case CHARIOT:
                value += centre * 2;
                break;
            default:
        }
        total += side * value;
    }
    return total;
}

const MATE = 100000;
class OutOfTime extends Error {}

function captureOrder(board, move) {
    const victim = board[move & 127];
    if (!victim) return 0;
    return VALUE[kindOf(victim)] * 10 - VALUE[kindOf(board[move >> 7])];
}

/** Captures only, until the position is quiet, so a search does not stop in the middle of an exchange. */
function quiet(board, side, alpha, beta, depth, clock) {
    clock.tick();
    const stand = side * evaluate(board);
    if (depth === 0) return stand;
    if (stand >= beta) return stand;
    let best = stand;
    alpha = Math.max(alpha, stand);
    const pseudo = [];
    for (let i = 0; i < 90; i++) if (sideOf(board[i]) === side) pieceMoves(board, i, pseudo);
    const captures = pseudo.filter((m) => board[m & 127]).sort((a, b) => captureOrder(board, b) - captureOrder(board, a));
    for (const move of captures) {
        const captured = applyMove(board, move);
        if (kindOf(captured) === KING) {
            undoMove(board, move, captured);
            return MATE;
        }
        let score;
        if (inCheck(board, side)) score = -Infinity;
        else score = -quiet(board, -side, -beta, -alpha, depth - 1, clock);
        undoMove(board, move, captured);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    return best;
}

function negamax(board, side, depth, alpha, beta, ply, clock) {
    clock.tick();
    if (depth === 0) return quiet(board, side, alpha, beta, 3, clock);
    const moves = legalMoves(board, side);
    if (moves.length === 0) return -MATE + ply;
    moves.sort((a, b) => captureOrder(board, b) - captureOrder(board, a));
    let best = -Infinity;
    for (const move of moves) {
        const captured = applyMove(board, move);
        const score = -negamax(board, -side, depth - 1, -beta, -alpha, ply + 1, clock);
        undoMove(board, move, captured);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    return best;
}

function makeClock(ms) {
    const deadline = performance.now() + ms;
    let nodes = 0;
    return {
        tick() {
            if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new OutOfTime();
        },
    };
}

/** Each legal move with what it is worth to `side` after `depth` plies of looking ahead. */
function scoreRoot(board, side, moves, depth, clock) {
    return moves.map((move) => {
        const captured = applyMove(board, move);
        const score = -negamax(board, -side, depth - 1, -MATE, MATE, 1, clock);
        undoMove(board, move, captured);
        return { move, score };
    });
}

// --- Openings ------------------------------------------------------------------
//
// With the pieces all at home almost every sensible first move is worth the same to
// a search, so left alone a bot plays the same one every game. These are the usual
// first moves for red (from row, col, to row, col); black draws from the same list
// turned round, as its reply.

const OPENING_BOARD = initialBoard();
const OPENINGS = [
    [7, 1, 7, 4], // cannon to the centre
    [7, 7, 7, 4], // the other cannon to the centre
    [9, 1, 7, 2], // a horse out
    [9, 7, 7, 6], // the other horse out
    [9, 2, 7, 4], // an elephant to the centre
    [9, 6, 7, 4], // the other elephant to the centre
    [6, 2, 5, 2], // a pawn forward
    [6, 6, 5, 6], // the other pawn forward
];

/** How far the position is from the start, in squares that differ (two to a move). */
function movesAway(board) {
    let differing = 0;
    for (let i = 0; i < 90; i++) if (board[i] !== OPENING_BOARD[i]) differing++;
    return differing;
}

/** A first move or reply drawn from the openings, or null once the game has moved on. */
function bookMove(board, side, legal, rng) {
    if (movesAway(board) > 2) return null;
    const turned = (r, c) => (side === RED ? idxOf(r, c) : idxOf(9 - r, 8 - c));
    const book = OPENINGS.map(([fr, fc, tr, tc]) => makeMove(turned(fr, fc), turned(tr, tc))).filter((m) => legal.includes(m));
    return book.length ? book[Math.floor(rng() * book.length)] : null;
}

/**
 * A move for `side`, or null when it has none. `easy` takes a capture now and
 * then and otherwise wanders; `medium` looks two plies ahead; `hard` keeps
 * deepening until its time is up. `rng` is for the tests.
 */
export function chooseMove(board, side, level = 'medium', rng = Math.random) {
    const moves = legalMoves(board, side);
    if (moves.length === 0) return null;
    const work = board.slice();

    // Every level opens from the book, so no two games begin alike. Easy then
    // wanders on its own; the others keep a wider choice for a few more moves.
    const opening = bookMove(work, side, moves, rng);
    if (opening !== null) return opening;
    const early = movesAway(work) <= 8;

    if (level === 'easy') {
        const captures = moves.filter((m) => work[m & 127]);
        if (captures.length && rng() < 0.45) {
            captures.sort((a, b) => captureOrder(work, b) - captureOrder(work, a));
            return captures[0];
        }
        return moves[Math.floor(rng() * moves.length)];
    }

    if (level === 'medium') {
        let scored;
        try {
            scored = scoreRoot(work, side, moves, 2, makeClock(900));
        } catch {
            return moves[Math.floor(rng() * moves.length)];
        }
        const best = Math.max(...scored.map((s) => s.score));
        // Moves worth the same to within a little are a coin toss.
        const pool = scored.filter((s) => s.score >= best - (early ? 40 : 12));
        return pool[Math.floor(rng() * pool.length)].move;
    }

    // hard: deeper each round, keeping the last round that finished.
    const clock = makeClock(1700);
    let best = moves[0];
    let last = null; // the last round that finished
    let order = moves.slice().sort((a, b) => captureOrder(work, b) - captureOrder(work, a));
    for (let depth = 1; depth <= 6; depth++) {
        let scored;
        try {
            scored = scoreRoot(work, side, order, depth, clock);
        } catch (err) {
            if (err instanceof OutOfTime) break;
            throw err;
        }
        scored.sort((a, b) => b.score - a.score);
        best = scored[0].move;
        last = scored;
        order = scored.map((s) => s.move);
        if (scored[0].score >= MATE - 50) break; // a mate is found
    }
    // Never a choice when a win is in sight; otherwise the early moves are drawn from
    // those the search rates alike, so the same position is not always met the same way.
    if (last && last[0].score < MATE - 50) {
        const window = early ? 30 : 3;
        const pool = last.filter((s) => s.score >= last[0].score - window);
        return pool[Math.floor(rng() * pool.length)].move;
    }
    return best;
}
