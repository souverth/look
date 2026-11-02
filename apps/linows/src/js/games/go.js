// Go (cờ vây, weiqi, baduk): the rules and the bots that play it. Pure, so it runs
// under node and the panel only draws what this decides.
//
// Rules: stones are taken when they have no liberties; a move that would leave
// its own group without one is not allowed unless it takes something; a move
// may not repeat the board an opponent's single-stone capture just left (simple
// ko); the game ends when both sides pass in a row. Score is by area (stones plus
// territory) with komi, and the dead stones are found by playing the position out at
// random many times rather than by asking the players to mark them.
//
// A variant, Atari Go, ends the game at the first capture.

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export const PASS = -1;
export const LEVELS = ['easy', 'medium', 'hard'];
export const SIZES = [9, 13, 19];

export const other = (color) => 3 - color;
export const komiFor = (size) => (size === 9 ? 7 : 7.5);

const topologies = new Map();

/** For a board size: each point's up-to-four neighbours (-1 pads) and four diagonals. */
function topology(size) {
    let t = topologies.get(size);
    if (t) return t;
    const n = size * size;
    const nb = new Int16Array(n * 4).fill(-1);
    const dg = new Int16Array(n * 4).fill(-1);
    for (let i = 0; i < n; i++) {
        const r = Math.floor(i / size);
        const c = i % size;
        let k = 0;
        for (const [dr, dc] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
        ]) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && rr < size && cc >= 0 && cc < size) nb[i * 4 + k++] = rr * size + cc;
        }
        k = 0;
        for (const [dr, dc] of [
            [-1, -1],
            [-1, 1],
            [1, -1],
            [1, 1],
        ]) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && rr < size && cc >= 0 && cc < size) dg[i * 4 + k++] = rr * size + cc;
        }
    }
    t = { size, n, nb, dg };
    topologies.set(size, t);
    return t;
}

export class Position {
    constructor(size = 9, captureGoal = 0) {
        this.size = size;
        this.t = topology(size);
        this.n = size * size;
        this.board = new Uint8Array(this.n);
        this.toPlay = BLACK;
        this.ko = -1; // the point the side to move may not play, or -1
        this.captured = [0, 0, 0]; // stones taken by black and by white, index = colour
        this.passes = 0; // passes in a row
        this.last = -2; // the last move: a point, PASS, or -2 at the start
        this.captureGoal = captureGoal; // 0: ordinary; k: the first to take k stones wins
        this.mark = new Int32Array(this.n);
        this.stamp = 1;
        this.grp = new Int16Array(this.n);
        this.gn = 0;
        this.queue = new Int16Array(this.n);
    }

    clone() {
        const p = new Position(this.size, this.captureGoal);
        p.board.set(this.board);
        p.toPlay = this.toPlay;
        p.ko = this.ko;
        p.captured = this.captured.slice();
        p.passes = this.passes;
        p.last = this.last;
        return p;
    }

    /**
     * The liberties of the group holding `idx`. Fills `grp[0..gn)` with its stones.
     */
    libertiesOf(idx) {
        const { board, t, grp, mark, queue } = this;
        const color = board[idx];
        const stoneMark = this.stamp;
        const libMark = this.stamp + 1;
        this.stamp += 2;
        let libs = 0;
        let head = 0;
        let tail = 0;
        queue[tail++] = idx;
        mark[idx] = stoneMark;
        let count = 0;
        while (head < tail) {
            const p = queue[head++];
            grp[count++] = p;
            for (let k = 0; k < 4; k++) {
                const q = t.nb[p * 4 + k];
                if (q < 0) break;
                if (board[q] === color) {
                    if (mark[q] !== stoneMark) {
                        mark[q] = stoneMark;
                        queue[tail++] = q;
                    }
                } else if (board[q] === EMPTY && mark[q] !== libMark) {
                    mark[q] = libMark;
                    libs++;
                }
            }
        }
        this.gn = count;
        return libs;
    }

    /** Whether `color` may play at `idx` (for the side to move this includes the ko rule). */
    isLegal(idx, color = this.toPlay) {
        const { board, t } = this;
        if (board[idx] !== EMPTY) return false;
        if (idx === this.ko && color === this.toPlay) return false;
        board[idx] = color;
        let ok = false;
        const foe = other(color);
        for (let k = 0; k < 4 && !ok; k++) {
            const q = t.nb[idx * 4 + k];
            if (q < 0) break;
            if (board[q] === foe && this.libertiesOf(q) === 0) ok = true;
        }
        if (!ok) ok = this.libertiesOf(idx) > 0;
        board[idx] = EMPTY;
        return ok;
    }

    /** A point whose four neighbours are `color`'s and that the other side could not use to live. */
    isEye(idx, color) {
        const { board, t } = this;
        if (board[idx] !== EMPTY) return false;
        for (let k = 0; k < 4; k++) {
            const q = t.nb[idx * 4 + k];
            if (q < 0) break;
            if (board[q] !== color) return false;
        }
        // The diagonals: at the edge all of them must be ours, inside at most one may not be.
        let bad = 0;
        let edge = t.nb[idx * 4 + 3] < 0;
        let seen = 0;
        for (let k = 0; k < 4; k++) {
            const q = t.dg[idx * 4 + k];
            if (q < 0) break;
            seen++;
            if (board[q] !== color) bad++;
        }
        edge = edge || seen < 4;
        return edge ? bad === 0 : bad <= 1;
    }

    /** Plays `idx` for the side to move. The caller has checked it is legal. */
    play(idx) {
        const { board, t } = this;
        const color = this.toPlay;
        const foe = other(color);
        board[idx] = color;
        let taken = 0;
        let lone = -1;
        for (let k = 0; k < 4; k++) {
            const q = t.nb[idx * 4 + k];
            if (q < 0) break;
            if (board[q] === foe && this.libertiesOf(q) === 0) {
                if (this.gn === 1) lone = this.grp[0];
                for (let i = 0; i < this.gn; i++) board[this.grp[i]] = EMPTY;
                taken += this.gn;
            }
        }
        this.captured[color] += taken;
        this.ko = -1;
        if (taken === 1) {
            const libs = this.libertiesOf(idx);
            if (this.gn === 1 && libs === 1) this.ko = lone;
        }
        this.passes = 0;
        this.last = idx;
        this.toPlay = foe;
    }

    pass() {
        this.toPlay = other(this.toPlay);
        this.passes++;
        this.ko = -1;
        this.last = PASS;
    }

    /** The colour that has won by capture in the Atari variant, or 0. */
    captureWinner() {
        if (!this.captureGoal) return 0;
        if (this.captured[BLACK] >= this.captureGoal) return BLACK;
        if (this.captured[WHITE] >= this.captureGoal) return WHITE;
        return 0;
    }

    get over() {
        return this.passes >= 2 || this.captureWinner() !== 0;
    }

    /** Every legal point for `color`, leaving out filling one's own eye when `skipEyes`. */
    legalMoves(color = this.toPlay, skipEyes = false) {
        const out = [];
        for (let i = 0; i < this.n; i++) {
            if (this.board[i] !== EMPTY) continue;
            if (!this.isLegal(i, color)) continue;
            if (skipEyes && this.isEye(i, color)) continue;
            out.push(i);
        }
        return out;
    }

    /** Whether playing `idx` would take stones, without playing it. */
    capturesAt(idx, color = this.toPlay) {
        const { board, t } = this;
        if (board[idx] !== EMPTY) return 0;
        board[idx] = color;
        let taken = 0;
        const foe = other(color);
        const seen = [];
        for (let k = 0; k < 4; k++) {
            const q = t.nb[idx * 4 + k];
            if (q < 0) break;
            if (board[q] === foe && !seen.includes(q) && this.libertiesOf(q) === 0) {
                taken += this.gn;
                for (let i = 0; i < this.gn; i++) seen.push(this.grp[i]);
            }
        }
        board[idx] = EMPTY;
        return taken;
    }

    /**
     * Whose each point is by area: the colour of a stone, or of the only colour an empty
     * region touches, or 0. Stones are taken as they stand.
     */
    areaOwners() {
        const { board, t, queue, mark } = this;
        const owners = new Uint8Array(this.n);
        const stamp = this.stamp++;
        for (let i = 0; i < this.n; i++) {
            if (board[i] !== EMPTY) {
                owners[i] = board[i];
                continue;
            }
            if (mark[i] === stamp) continue;
            let head = 0;
            let tail = 0;
            queue[tail++] = i;
            mark[i] = stamp;
            let touches = 0; // bit 1 black, bit 2 white
            while (head < tail) {
                const p = queue[head++];
                for (let k = 0; k < 4; k++) {
                    const q = t.nb[p * 4 + k];
                    if (q < 0) break;
                    if (board[q] === EMPTY) {
                        if (mark[q] !== stamp) {
                            mark[q] = stamp;
                            queue[tail++] = q;
                        }
                    } else touches |= board[q];
                }
            }
            const owner = touches === BLACK ? BLACK : touches === WHITE ? WHITE : 0;
            for (let j = 0; j < tail; j++) owners[queue[j]] = owner;
        }
        return owners;
    }
}

// --- Playing a position out ----------------------------------------------------

/** A random legal point that does not fill the mover's own eye, or PASS. */
function randomMove(pos, rng) {
    const { board, n } = pos;
    const color = pos.toPlay;
    for (let tries = 0; tries < 14; tries++) {
        const idx = Math.floor(rng() * n);
        if (board[idx] === EMPTY && pos.isLegal(idx) && !pos.isEye(idx, color)) return idx;
    }
    // Crowded: look at every point, from a random start so no corner is favoured.
    const start = Math.floor(rng() * n);
    for (let i = 0; i < n; i++) {
        const idx = (start + i) % n;
        if (board[idx] === EMPTY && pos.isLegal(idx) && !pos.isEye(idx, color)) return idx;
    }
    return PASS;
}

/**
 * Plays `pos` (which it changes) to the end at random and says who won: BLACK or
 * WHITE, by capture in the Atari variant and otherwise by area with komi.
 */
export function playout(pos, rng, komi) {
    const limit = pos.n * 3;
    for (let moves = 0; moves < limit && !pos.over; moves++) {
        const move = randomMove(pos, rng);
        if (move === PASS) pos.pass();
        else pos.play(move);
    }
    const byCapture = pos.captureWinner();
    if (byCapture) return byCapture;
    if (pos.captureGoal) return 0; // Atari with nothing taken: no winner
    const owners = pos.areaOwners();
    let black = 0;
    let white = 0;
    for (let i = 0; i < owners.length; i++) {
        if (owners[i] === BLACK) black++;
        else if (owners[i] === WHITE) white++;
    }
    return black - white - komi > 0 ? BLACK : WHITE;
}

/**
 * Who owns each point once `pos` is played out at random `runs` times: +1 is all
 * black, -1 all white. Dead stones come out owned by the other side.
 */
export function ownership(pos, rng, runs = 200, komi = komiFor(pos.size)) {
    const tally = new Float32Array(pos.n);
    for (let r = 0; r < runs; r++) {
        const work = pos.clone();
        work.passes = 0; // play on from the final position rather than stopping at once
        playout(work, rng, komi);
        const owners = work.areaOwners();
        for (let i = 0; i < pos.n; i++) tally[i] += owners[i] === BLACK ? 1 : owners[i] === WHITE ? -1 : 0;
    }
    for (let i = 0; i < pos.n; i++) tally[i] /= runs;
    return tally;
}

/** The final score from an ownership map: black's points, white's points, and each point's owner. */
export function settle(pos, owned, komi = komiFor(pos.size)) {
    const owners = new Uint8Array(pos.n);
    let black = 0;
    let white = 0;
    for (let i = 0; i < pos.n; i++) {
        if (owned[i] > 0.35) {
            owners[i] = BLACK;
            black++;
        } else if (owned[i] < -0.35) {
            owners[i] = WHITE;
            white++;
        }
    }
    const dead = [];
    for (let i = 0; i < pos.n; i++) if (pos.board[i] !== EMPTY && owners[i] !== 0 && owners[i] !== pos.board[i]) dead.push(i);
    const margin = black - white - komi;
    return { black, white: white + komi, komi, margin, winner: margin > 0 ? BLACK : WHITE, owners, dead };
}

// --- The bots --------------------------------------------------------------------

/** How good a point looks before any playing out: a cheap guess to order candidates by. */
function eagerness(pos, idx) {
    const { board, t, size } = pos;
    const color = pos.toPlay;
    const foe = other(color);
    let score = 0;
    const taken = pos.capturesAt(idx, color);
    score += taken * 40;
    let friends = 0;
    let foes = 0;
    for (let k = 0; k < 4; k++) {
        const q = t.nb[idx * 4 + k];
        if (q < 0) break;
        if (board[q] === color) {
            friends++;
            // Rescuing a group that is nearly out of liberties.
            board[idx] = color;
            const libs = pos.libertiesOf(q);
            board[idx] = EMPTY;
            if (libs <= 2) score += 12;
        } else if (board[q] === foe) {
            foes++;
            // Pressing a group that is nearly out of liberties.
            board[idx] = color;
            const libs = pos.libertiesOf(q);
            board[idx] = EMPTY;
            if (libs === 1) score += 20;
            else if (libs === 2) score += 8;
        }
    }
    score += friends * 2 + foes * 3;
    // Away from the edge, and not on the very first line unless something is going on.
    const r = Math.floor(idx / size);
    const c = idx % size;
    const edge = Math.min(r, c, size - 1 - r, size - 1 - c);
    score += edge === 0 ? -8 : edge === 1 ? -1 : edge === 2 ? 4 : 3;
    return score;
}

/** Easy: takes what it can, sometimes saves a group in trouble, otherwise wanders. */
function chooseEasy(pos, rng) {
    const moves = pos.legalMoves(pos.toPlay, true);
    if (moves.length === 0) return PASS;
    const taking = moves.filter((m) => pos.capturesAt(m) > 0);
    if (taking.length && rng() < 0.7) return taking[Math.floor(rng() * taking.length)];
    // Near the other stones rather than anywhere on a bare board.
    const near = moves.filter((m) => eagerness(pos, m) > -2);
    const pool = near.length ? near : moves;
    return pool[Math.floor(rng() * pool.length)];
}

/** Medium: the best few points by the quick guess, each tried with a handful of random games. */
function chooseMedium(pos, rng, komi, ms) {
    const moves = pos.legalMoves(pos.toPlay, true);
    if (moves.length === 0) return PASS;
    const ranked = moves
        .map((m) => ({ m, s: eagerness(pos, m) + rng() * 3 }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 12);
    const deadline = performance.now() + ms;
    const color = pos.toPlay;
    const wins = new Float32Array(ranked.length);
    const runs = new Float32Array(ranked.length);
    let round = 0;
    while (performance.now() < deadline || round < 2) {
        for (let i = 0; i < ranked.length; i++) {
            const work = pos.clone();
            work.play(ranked[i].m);
            runs[i]++;
            if (playout(work, rng, komi) === color) wins[i]++;
        }
        round++;
        if (round > 400) break;
    }
    let best = 0;
    let bestRate = -1;
    for (let i = 0; i < ranked.length; i++) {
        const rate = wins[i] / runs[i];
        if (rate > bestRate) {
            bestRate = rate;
            best = i;
        }
    }
    // The other side has passed and we are ahead: end it.
    if (pos.passes > 0 && bestRate > 0.55) return PASS;
    return ranked[best].m;
}

class Node {
    constructor(move, parent, mover) {
        this.move = move; // the move that led here
        this.parent = parent;
        this.mover = mover; // who made it
        this.children = [];
        this.untried = null; // legal moves not yet tried, set on first visit
        this.visits = 0;
        this.wins = 0; // games won by `mover`
    }
}

function legalForTree(pos, rng) {
    const moves = pos.legalMoves(pos.toPlay, true);
    // Shuffle, so the order of expansion is not the order of the board.
    for (let i = moves.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [moves[i], moves[j]] = [moves[j], moves[i]];
    }
    // Passing is a move once the other side has, and the only one when nothing else is left.
    if (pos.passes > 0 || moves.length === 0) moves.push(PASS);
    return moves;
}

/** Hard: a tree of positions grown for as long as the time allows (UCT). */
function chooseHard(pos, rng, komi, ms) {
    const root = new Node(null, null, other(pos.toPlay));
    const deadline = performance.now() + ms;
    let iterations = 0;
    const C = 0.8;
    while (iterations < 3 || performance.now() < deadline) {
        const work = pos.clone();
        let node = root;
        // Selection and expansion.
        for (;;) {
            if (work.over) break;
            if (node.untried === null) node.untried = legalForTree(work, rng);
            if (node.untried.length > 0) {
                const move = node.untried.pop();
                const child = new Node(move, node, work.toPlay);
                node.children.push(child);
                if (move === PASS) work.pass();
                else work.play(move);
                node = child;
                break;
            }
            if (node.children.length === 0) break;
            let best = null;
            let bestValue = -Infinity;
            const logN = Math.log(node.visits + 1);
            for (const child of node.children) {
                const value = child.wins / child.visits + C * Math.sqrt(logN / child.visits);
                if (value > bestValue) {
                    bestValue = value;
                    best = child;
                }
            }
            node = best;
            if (node.move === PASS) work.pass();
            else work.play(node.move);
        }
        const winner = work.over && work.captureWinner() ? work.captureWinner() : playout(work, rng, komi);
        for (let p = node; p !== null; p = p.parent) {
            p.visits++;
            if (p.mover === winner) p.wins++;
        }
        iterations++;
    }
    let best = null;
    for (const child of root.children) if (!best || child.visits > best.visits) best = child;
    if (!best) return PASS;
    // Ending the game by passing only when it is clearly won.
    if (best.move === PASS && best.wins / best.visits < 0.5) {
        const second = root.children.filter((c) => c !== best).sort((a, b) => b.visits - a.visits)[0];
        if (second) return second.move;
    }
    return best.move;
}

/** The first moves are drawn rather than worked out, so no two games begin alike. */
function opening(pos, rng) {
    const { size } = pos;
    const placed = pos.board.reduce((n, c) => n + (c ? 1 : 0), 0);
    if (placed > 1) return null;
    const lo = size === 9 ? 2 : 3;
    const hi = size - 1 - lo;
    const spots = [];
    const mid = (size - 1) / 2;
    for (const r of [lo, hi, mid]) for (const c of [lo, hi, mid]) spots.push(r * size + c);
    const open = spots.filter((i) => pos.board[i] === EMPTY && pos.isLegal(i));
    return open.length ? open[Math.floor(rng() * open.length)] : null;
}

/**
 * A point for the side to move, or PASS. `easy` takes stones and wanders; `medium`
 * tries the best few points with random games; `hard` grows a search tree. On a
 * big board the time is spread thin, so the bots play weaker there. `rng` is for the tests.
 */
export function chooseMove(pos, level = 'medium', rng = Math.random) {
    const komi = komiFor(pos.size);
    const start = opening(pos, rng);
    if (start !== null) return start;
    if (level === 'easy') return chooseEasy(pos, rng);
    const scale = pos.size === 9 ? 1 : pos.size === 13 ? 1.4 : 1.8;
    if (level === 'medium') return chooseMedium(pos, rng, komi, 450 * scale);
    return chooseHard(pos, rng, komi, 1800 * scale);
}
