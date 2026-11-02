// Chess (cờ vua): the rules, and the bots that play it. Pure, so it runs under node
// and the panel only draws what this decides.
//
// The board is 64 squares, `row * 8 + file`, row 0 at the top (rank 8, where black
// starts). A piece is a signed number: positive white, negative black, the size
// saying what it is. A move is `from | to << 6 | promotion << 12 | flag << 15`.
//
// Everything is implemented: castling, en passant, promotion, check, checkmate,
// stalemate, and the draws by the fifty-move rule, by repetition and by too little
// material to mate with.

export const WHITE = 1;
export const BLACK = -1;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export const LEVELS = ['easy', 'medium', 'hard'];

const FLAG_CASTLE = 1;
const FLAG_EP = 2;
const FLAG_DOUBLE = 3;

export const makeMove = (from, to, promo = 0, flag = 0) => from | (to << 6) | (promo << 12) | (flag << 15);
export const moveFrom = (m) => m & 63;
export const moveTo = (m) => (m >> 6) & 63;
export const movePromo = (m) => (m >> 12) & 7;
export const moveFlag = (m) => m >> 15;

export const rowOf = (sq) => sq >> 3;
export const fileOf = (sq) => sq & 7;
export const squareOf = (row, file) => row * 8 + file;
export const sideOf = (piece) => (piece > 0 ? WHITE : piece < 0 ? BLACK : 0);
export const kindOf = (piece) => Math.abs(piece);

/** "e4" for a square, as chess writes it. */
export const nameOf = (sq) => `${'abcdefgh'[fileOf(sq)]}${8 - rowOf(sq)}`;

// Castling rights are four bits; what a move from or to a square does to them.
const WK = 1;
const WQ = 2;
const BK = 4;
const BQ = 8;
const CASTLE_MASK = new Uint8Array(64).fill(15);
CASTLE_MASK[60] = 15 & ~(WK | WQ);
CASTLE_MASK[63] = 15 & ~WK;
CASTLE_MASK[56] = 15 & ~WQ;
CASTLE_MASK[4] = 15 & ~(BK | BQ);
CASTLE_MASK[7] = 15 & ~BK;
CASTLE_MASK[0] = 15 & ~BQ;

const KNIGHT_STEPS = [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
];
const KING_STEPS = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
];
const ROOK_DIRS = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
];
const BISHOP_DIRS = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
];

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FEN_PIECES = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };

export class Chess {
    constructor() {
        this.board = new Int8Array(64);
        this.turn = WHITE;
        this.castling = 0;
        this.ep = -1; // the square a pawn that has just advanced two passed over, or -1
        this.halfmove = 0;
        this.fullmove = 1;
        this.wk = 60;
        this.bk = 4;
        this.stack = []; // what each move needs to be taken back
        this.keys = []; // positions seen, for the repetition rule (kept by play/takeBack)
    }

    static fromFen(fen = START_FEN) {
        const g = new Chess();
        const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
        placement.split('/').forEach((line, row) => {
            let file = 0;
            for (const ch of line) {
                if (/\d/.test(ch)) file += Number(ch);
                else {
                    const kind = FEN_PIECES[ch.toLowerCase()];
                    const sq = squareOf(row, file++);
                    g.board[sq] = ch === ch.toUpperCase() ? kind : -kind;
                    if (kind === KING) {
                        if (ch === 'K') g.wk = sq;
                        else g.bk = sq;
                    }
                }
            }
        });
        g.turn = turn === 'b' ? BLACK : WHITE;
        g.castling = 0;
        for (const ch of castling ?? '-') g.castling |= { K: WK, Q: WQ, k: BK, q: BQ }[ch] ?? 0;
        g.ep = ep && ep !== '-' ? squareOf(8 - Number(ep[1]), 'abcdefgh'.indexOf(ep[0])) : -1;
        g.halfmove = Number(half ?? 0);
        g.fullmove = Number(full ?? 1);
        g.keys = [g.positionKey()];
        return g;
    }

    clone() {
        const g = new Chess();
        g.board.set(this.board);
        g.turn = this.turn;
        g.castling = this.castling;
        g.ep = this.ep;
        g.halfmove = this.halfmove;
        g.fullmove = this.fullmove;
        g.wk = this.wk;
        g.bk = this.bk;
        return g;
    }

    /** What makes two positions the same for the repetition rule. */
    positionKey() {
        return `${this.board.join(',')}|${this.turn}|${this.castling}|${this.ep}`;
    }

    // --- Attacks and check ---------------------------------------------------------

    /** Whether `by` has a piece attacking `sq`. */
    isAttacked(sq, by) {
        const b = this.board;
        const row = sq >> 3;
        const col = sq & 7;
        // Pawns attack toward the other side's end: a white pawn from below, black from above.
        const pr = row - (by === WHITE ? -1 : 1);
        if (pr >= 0 && pr < 8) {
            if (col > 0 && b[squareOf(pr, col - 1)] === by * PAWN) return true;
            if (col < 7 && b[squareOf(pr, col + 1)] === by * PAWN) return true;
        }
        for (const [dr, dc] of KNIGHT_STEPS) {
            const r = row + dr;
            const c = col + dc;
            if (r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === by * KNIGHT) return true;
        }
        for (const [dr, dc] of KING_STEPS) {
            const r = row + dr;
            const c = col + dc;
            if (r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === by * KING) return true;
        }
        for (const [dr, dc] of ROOK_DIRS) {
            let r = row + dr;
            let c = col + dc;
            while (r >= 0 && r < 8 && c >= 0 && c < 8) {
                const p = b[r * 8 + c];
                if (p) {
                    if (p === by * ROOK || p === by * QUEEN) return true;
                    break;
                }
                r += dr;
                c += dc;
            }
        }
        for (const [dr, dc] of BISHOP_DIRS) {
            let r = row + dr;
            let c = col + dc;
            while (r >= 0 && r < 8 && c >= 0 && c < 8) {
                const p = b[r * 8 + c];
                if (p) {
                    if (p === by * BISHOP || p === by * QUEEN) return true;
                    break;
                }
                r += dr;
                c += dc;
            }
        }
        return false;
    }

    inCheck(side = this.turn) {
        return this.isAttacked(side === WHITE ? this.wk : this.bk, -side);
    }

    // --- Moves -----------------------------------------------------------------------

    /** Every move the side to move could make without regard to leaving its king in check. */
    pseudoMoves() {
        const out = [];
        const b = this.board;
        const side = this.turn;
        for (let from = 0; from < 64; from++) {
            const piece = b[from];
            if (!piece || sideOf(piece) !== side) continue;
            const row = from >> 3;
            const col = from & 7;
            switch (kindOf(piece)) {
                case PAWN: {
                    const dir = side === WHITE ? -1 : 1;
                    const start = side === WHITE ? 6 : 1;
                    const last = side === WHITE ? 0 : 7;
                    const one = from + dir * 8;
                    const addPush = (to, flag = 0) => {
                        if (to >> 3 === last) for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) out.push(makeMove(from, to, promo));
                        else out.push(makeMove(from, to, 0, flag));
                    };
                    if (!b[one]) {
                        addPush(one);
                        if (row === start && !b[one + dir * 8]) out.push(makeMove(from, one + dir * 8, 0, FLAG_DOUBLE));
                    }
                    for (const dc of [-1, 1]) {
                        const c = col + dc;
                        if (c < 0 || c > 7) continue;
                        const to = one + dc;
                        if (b[to] && sideOf(b[to]) === -side) addPush(to);
                        else if (to === this.ep) out.push(makeMove(from, to, 0, FLAG_EP));
                    }
                    break;
                }
                case KNIGHT:
                    for (const [dr, dc] of KNIGHT_STEPS) {
                        const r = row + dr;
                        const c = col + dc;
                        if (r < 0 || r > 7 || c < 0 || c > 7) continue;
                        if (sideOf(b[r * 8 + c]) !== side) out.push(makeMove(from, r * 8 + c));
                    }
                    break;
                case KING:
                    for (const [dr, dc] of KING_STEPS) {
                        const r = row + dr;
                        const c = col + dc;
                        if (r < 0 || r > 7 || c < 0 || c > 7) continue;
                        if (sideOf(b[r * 8 + c]) !== side) out.push(makeMove(from, r * 8 + c));
                    }
                    this.#castles(side, from, out);
                    break;
                default: {
                    const dirs = kindOf(piece) === ROOK ? ROOK_DIRS : kindOf(piece) === BISHOP ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
                    for (const [dr, dc] of dirs) {
                        let r = row + dr;
                        let c = col + dc;
                        while (r >= 0 && r < 8 && c >= 0 && c < 8) {
                            const to = r * 8 + c;
                            if (b[to]) {
                                if (sideOf(b[to]) !== side) out.push(makeMove(from, to));
                                break;
                            }
                            out.push(makeMove(from, to));
                            r += dr;
                            c += dc;
                        }
                    }
                }
            }
        }
        return out;
    }

    #castles(side, from, out) {
        const b = this.board;
        const home = side === WHITE ? 60 : 4;
        if (from !== home) return;
        const rights = side === WHITE ? [WK, WQ] : [BK, BQ];
        const foe = -side;
        const kingside = (this.castling & rights[0]) !== 0;
        const queenside = (this.castling & rights[1]) !== 0;
        if (!kingside && !queenside) return;
        if (this.isAttacked(home, foe)) return;
        if (kingside && !b[home + 1] && !b[home + 2] && b[home + 3] === side * ROOK) {
            if (!this.isAttacked(home + 1, foe) && !this.isAttacked(home + 2, foe)) out.push(makeMove(home, home + 2, 0, FLAG_CASTLE));
        }
        if (queenside && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === side * ROOK) {
            if (!this.isAttacked(home - 1, foe) && !this.isAttacked(home - 2, foe)) out.push(makeMove(home, home - 2, 0, FLAG_CASTLE));
        }
    }

    make(m) {
        const from = m & 63;
        const to = (m >> 6) & 63;
        const promo = (m >> 12) & 7;
        const flag = m >> 15;
        const b = this.board;
        const side = this.turn;
        const piece = b[from];
        let captured = b[to];
        let capturedAt = to;
        if (flag === FLAG_EP) {
            capturedAt = to + (side === WHITE ? 8 : -8);
            captured = b[capturedAt];
            b[capturedAt] = 0;
        }
        this.stack.push({ m, captured, capturedAt, castling: this.castling, ep: this.ep, halfmove: this.halfmove });
        b[to] = promo ? side * promo : piece;
        b[from] = 0;
        if (flag === FLAG_CASTLE) {
            if (to > from) {
                b[from + 1] = b[from + 3];
                b[from + 3] = 0;
            } else {
                b[from - 1] = b[from - 4];
                b[from - 4] = 0;
            }
        }
        if (kindOf(piece) === KING) {
            if (side === WHITE) this.wk = to;
            else this.bk = to;
        }
        this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
        this.ep = flag === FLAG_DOUBLE ? (from + to) >> 1 : -1;
        this.halfmove = kindOf(piece) === PAWN || captured ? 0 : this.halfmove + 1;
        if (side === BLACK) this.fullmove++;
        this.turn = -side;
    }

    unmake() {
        const { m, captured, capturedAt, castling, ep, halfmove } = this.stack.pop();
        const from = m & 63;
        const to = (m >> 6) & 63;
        const promo = (m >> 12) & 7;
        const flag = m >> 15;
        const b = this.board;
        const side = -this.turn;
        this.turn = side;
        if (side === BLACK) this.fullmove--;
        b[from] = promo ? side * PAWN : b[to];
        b[to] = 0;
        if (flag === FLAG_EP) b[capturedAt] = captured;
        else b[to] = captured;
        if (flag === FLAG_CASTLE) {
            if (to > from) {
                b[from + 3] = b[from + 1];
                b[from + 1] = 0;
            } else {
                b[from - 4] = b[from - 1];
                b[from - 1] = 0;
            }
        }
        if (kindOf(b[from]) === KING) {
            if (side === WHITE) this.wk = from;
            else this.bk = from;
        }
        this.castling = castling;
        this.ep = ep;
        this.halfmove = halfmove;
    }

    /** Moves for the side to move that leave its king safe. */
    legalMoves() {
        const side = this.turn;
        const legal = [];
        for (const m of this.pseudoMoves()) {
            this.make(m);
            if (!this.inCheck(side)) legal.push(m);
            this.unmake();
        }
        return legal;
    }

    /** The destinations of the piece on `from`, with their moves (a promotion has four per square). */
    movesFrom(from) {
        return this.legalMoves().filter((m) => moveFrom(m) === from);
    }

    /** Plays a move and notes the position, for the repetition rule. */
    play(m) {
        this.make(m);
        this.keys.push(this.positionKey());
    }

    takeBack() {
        this.keys.pop();
        this.unmake();
    }

    // --- How a game stands -----------------------------------------------------------

    /** Too few pieces for either side to be able to mate. */
    insufficientMaterial() {
        const minors = [];
        for (let i = 0; i < 64; i++) {
            const kind = kindOf(this.board[i]);
            if (!kind || kind === KING) continue;
            if (kind === PAWN || kind === ROOK || kind === QUEEN) return false;
            minors.push(kind);
        }
        return minors.length <= 1;
    }

    repetitions() {
        const now = this.keys[this.keys.length - 1];
        return now === undefined ? 1 : this.keys.filter((k) => k === now).length;
    }

    /**
     * `play` and `check` carry on; `checkmate` ends it for the side to move; the rest
     * are draws, with `reason` saying which.
     */
    status() {
        const moves = this.legalMoves();
        const check = this.inCheck();
        if (moves.length === 0) return { state: check ? 'checkmate' : 'stalemate', check, moves };
        if (this.insufficientMaterial()) return { state: 'draw', reason: 'not enough material to mate', check, moves };
        if (this.halfmove >= 100) return { state: 'draw', reason: 'fifty moves without a capture or pawn move', check, moves };
        if (this.repetitions() >= 3) return { state: 'draw', reason: 'the same position three times', check, moves };
        return { state: check ? 'check' : 'play', check, moves };
    }
}

export function perft(g, depth) {
    if (depth === 0) return 1;
    let total = 0;
    const side = g.turn;
    for (const m of g.pseudoMoves()) {
        g.make(m);
        if (!g.inCheck(side)) total += perft(g, depth - 1);
        g.unmake();
    }
    return total;
}

// --- Judging a position --------------------------------------------------------

const VALUE = [0, 100, 320, 330, 500, 900, 20000];

// Where a piece likes to stand, from white's side (row 0 is rank 8). Black reads
// them mirrored. The "simplified evaluation function" tables.
const PST = [
    null,
    [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
];
const KING_ENDGAME = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

/** White's lead in centipawns. */
function evaluate(g) {
    const b = g.board;
    let total = 0;
    let queens = 0;
    let minorsAndRooks = 0;
    for (let i = 0; i < 64; i++) {
        const p = b[i];
        if (!p) continue;
        const kind = kindOf(p);
        if (kind === QUEEN) queens++;
        else if (kind !== PAWN && kind !== KING) minorsAndRooks++;
    }
    const endgame = queens === 0 || minorsAndRooks <= 2;
    for (let i = 0; i < 64; i++) {
        const p = b[i];
        if (!p) continue;
        const side = sideOf(p);
        const kind = kindOf(p);
        const spot = side === WHITE ? i : i ^ 56;
        const table = kind === KING && endgame ? KING_ENDGAME : PST[kind];
        total += side * (VALUE[kind] + table[spot]);
    }
    return total;
}

const MATE = 100000;
class OutOfTime extends Error {}

function makeClock(ms) {
    const deadline = performance.now() + ms;
    let nodes = 0;
    return {
        tick() {
            if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new OutOfTime();
        },
    };
}

function orderValue(g, m) {
    const victim = kindOf(g.board[moveTo(m)]);
    const attacker = kindOf(g.board[moveFrom(m)]);
    let score = 0;
    if (victim || moveFlag(m) === FLAG_EP) score += (victim || PAWN) * 100 - attacker;
    if (movePromo(m)) score += VALUE[movePromo(m)];
    return score;
}

function quiet(g, alpha, beta, clock, depth) {
    clock.tick();
    const stand = g.turn * evaluate(g);
    if (depth === 0 || stand >= beta) return stand;
    let best = stand;
    alpha = Math.max(alpha, stand);
    const side = g.turn;
    const moves = g
        .pseudoMoves()
        .filter((m) => g.board[moveTo(m)] || movePromo(m) || moveFlag(m) === FLAG_EP)
        .sort((x, y) => orderValue(g, y) - orderValue(g, x));
    for (const m of moves) {
        g.make(m);
        if (g.inCheck(side)) {
            g.unmake();
            continue;
        }
        const score = -quiet(g, -beta, -alpha, clock, depth - 1);
        g.unmake();
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    return best;
}

function negamax(g, depth, alpha, beta, ply, clock) {
    clock.tick();
    if (g.halfmove >= 100) return 0;
    const side = g.turn;
    const check = g.inCheck(side);
    if (check) depth++;
    if (depth <= 0) return quiet(g, alpha, beta, clock, 6);
    const moves = g.pseudoMoves().sort((x, y) => orderValue(g, y) - orderValue(g, x));
    let best = -Infinity;
    let legal = 0;
    for (const m of moves) {
        g.make(m);
        if (g.inCheck(side)) {
            g.unmake();
            continue;
        }
        legal++;
        const score = -negamax(g, depth - 1, -beta, -alpha, ply + 1, clock);
        g.unmake();
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    if (legal === 0) return check ? -MATE + ply : 0;
    return best;
}

function scoreRoot(g, moves, depth, clock) {
    return moves.map((m) => {
        g.make(m);
        const score = -negamax(g, depth - 1, -MATE, MATE, 1, clock);
        g.unmake();
        return { move: m, score };
    });
}

// --- Openings --------------------------------------------------------------------
//
// From the starting position nearly every sensible move scores the same, so left
// alone a bot opens the same way every game. White draws a first move from the
// usual ones; black answers from the replies that suit what white played.

const sq = (name) => squareOf(8 - Number(name[1]), 'abcdefgh'.indexOf(name[0]));
const book = (...pairs) => pairs.map(([a, b]) => makeMove(sq(a), sq(b), 0, 0));
const FIRST = [
    makeMove(sq('e2'), sq('e4'), 0, FLAG_DOUBLE),
    makeMove(sq('d2'), sq('d4'), 0, FLAG_DOUBLE),
    makeMove(sq('c2'), sq('c4'), 0, FLAG_DOUBLE),
    ...book(['g1', 'f3']),
];
const REPLIES = {
    // keyed by "from+to" of white's move
    e2e4: [makeMove(sq('e7'), sq('e5'), 0, FLAG_DOUBLE), makeMove(sq('c7'), sq('c5'), 0, FLAG_DOUBLE), ...book(['e7', 'e6']), ...book(['c7', 'c6'])],
    d2d4: [makeMove(sq('d7'), sq('d5'), 0, FLAG_DOUBLE), ...book(['g8', 'f6']), ...book(['e7', 'e6'])],
    c2c4: [makeMove(sq('e7'), sq('e5'), 0, FLAG_DOUBLE), ...book(['g8', 'f6']), makeMove(sq('c7'), sq('c5'), 0, FLAG_DOUBLE)],
    g1f3: [makeMove(sq('d7'), sq('d5'), 0, FLAG_DOUBLE), ...book(['g8', 'f6']), makeMove(sq('c7'), sq('c5'), 0, FLAG_DOUBLE)],
};

function bookMove(g, legal, rng) {
    if (g.fullmove !== 1 || g.stack.length > 1) return null;
    let choices = null;
    if (g.turn === WHITE && g.stack.length === 0) choices = FIRST;
    else if (g.turn === BLACK && g.stack.length === 1) choices = REPLIES[`${nameOf(moveFrom(g.stack[0].m))}${nameOf(moveTo(g.stack[0].m))}`] ?? null;
    if (!choices) return null;
    const usable = choices.filter((m) => legal.includes(m));
    return usable.length ? usable[Math.floor(rng() * usable.length)] : null;
}

/**
 * A move for the side to move, or null when it has none. `easy` takes a capture
 * now and then and otherwise wanders; `medium` looks two plies ahead; `hard` keeps
 * deepening until its time is up. `rng` is for the tests.
 */
export function chooseMove(game, level = 'medium', rng = Math.random) {
    const legal = game.legalMoves();
    if (legal.length === 0) return null;
    const first = bookMove(game, legal, rng);
    if (first !== null) return first;

    const g = game.clone();
    g.stack = [];
    // The first few moves are drawn from those the search rates alike.
    const early = game.fullmove <= 5;

    if (level === 'easy') {
        const captures = legal.filter((m) => game.board[moveTo(m)] || movePromo(m));
        if (captures.length && rng() < 0.45) {
            captures.sort((a, b) => orderValue(game, b) - orderValue(game, a));
            return captures[0];
        }
        return legal[Math.floor(rng() * legal.length)];
    }

    if (level === 'medium') {
        let scored;
        try {
            scored = scoreRoot(g, legal, 2, makeClock(900));
        } catch {
            return legal[Math.floor(rng() * legal.length)];
        }
        const best = Math.max(...scored.map((s) => s.score));
        const pool = scored.filter((s) => s.score >= best - (early ? 35 : 12));
        return pool[Math.floor(rng() * pool.length)].move;
    }

    // hard: deeper each round, keeping the last round that finished.
    const clock = makeClock(1700);
    let order = legal.slice().sort((a, b) => orderValue(game, b) - orderValue(game, a));
    let last = null;
    for (let depth = 1; depth <= 8; depth++) {
        let scored;
        try {
            scored = scoreRoot(g, order, depth, clock);
        } catch (err) {
            if (err instanceof OutOfTime) break;
            throw err;
        }
        scored.sort((a, b) => b.score - a.score);
        last = scored;
        order = scored.map((s) => s.move);
        if (scored[0].score >= MATE - 100) break; // a mate is found
    }
    if (!last) return legal[0];
    if (last[0].score >= MATE - 100) return last[0].move;
    const pool = last.filter((s) => s.score >= last[0].score - (early ? 25 : 3));
    return pool[Math.floor(rng() * pool.length)].move;
}
