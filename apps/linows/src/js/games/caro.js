// Caro (gomoku): five in a row on a 15x15 board, and the bots that play it. Pure,
// so it runs under node and the panel only draws what this decides.
//
// A cell is 0 (empty), 1 (X, who goes first) or 2 (O). Five or more in a row
// wins; there is no "blocked at both ends" rule.

export const SIZE = 15;
export const LEVELS = ['easy', 'medium', 'hard'];

const X = 1;
const O = 2;
const DIRS = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
];

export const emptyBoard = () => new Uint8Array(SIZE * SIZE);
export const other = (player) => (player === X ? O : X);
const at = (row, col) => row * SIZE + col;
const inside = (row, col) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;

/** The stones in a row through `idx` (five or more), or null. */
export function winLine(board, idx) {
    const player = board[idx];
    if (!player) return null;
    const row = Math.floor(idx / SIZE);
    const col = idx % SIZE;
    for (const [dr, dc] of DIRS) {
        const line = [idx];
        for (const sign of [1, -1]) {
            let r = row + dr * sign;
            let c = col + dc * sign;
            while (inside(r, c) && board[at(r, c)] === player) {
                line.push(at(r, c));
                r += dr * sign;
                c += dc * sign;
            }
        }
        if (line.length >= 5) return line;
    }
    return null;
}

export const isFull = (board) => board.every((cell) => cell !== 0);

/**
 * What a stone placed on `idx` would be worth to `player` along each line: the
 * run it would make and how many of its two ends are open.
 */
function lineScore(count, open) {
    if (count >= 5) return 1_000_000;
    if (open === 0) return 0;
    switch (count) {
        case 4:
            return open === 2 ? 100_000 : 10_000;
        case 3:
            return open === 2 ? 5_000 : 400;
        case 2:
            return open === 2 ? 400 : 40;
        default:
            return open === 2 ? 15 : 2;
    }
}

function placeScore(board, idx, player) {
    const row = Math.floor(idx / SIZE);
    const col = idx % SIZE;
    let total = 0;
    for (const [dr, dc] of DIRS) {
        let count = 1;
        let open = 0;
        for (const sign of [1, -1]) {
            let r = row + dr * sign;
            let c = col + dc * sign;
            while (inside(r, c) && board[at(r, c)] === player) {
                count++;
                r += dr * sign;
                c += dc * sign;
            }
            if (inside(r, c) && board[at(r, c)] === 0) open++;
        }
        total += lineScore(count, open);
    }
    return total;
}

/** Empty cells within two of a stone: the only places worth a look. The centre when the board is bare. */
function candidates(board) {
    const seen = new Set();
    let any = false;
    for (let idx = 0; idx < board.length; idx++) {
        if (!board[idx]) continue;
        any = true;
        const row = Math.floor(idx / SIZE);
        const col = idx % SIZE;
        for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
                const r = row + dr;
                const c = col + dc;
                if (inside(r, c) && !board[at(r, c)]) seen.add(at(r, c));
            }
        }
    }
    return any ? [...seen] : [at(7, 7)];
}

const byScoreDesc = (a, b) => b.score - a.score;

/** Cells ranked by what they do for `player` and what they stop the other from doing. */
function ranked(board, player, defence) {
    const opponent = other(player);
    return candidates(board)
        .map((idx) => ({ idx, score: placeScore(board, idx, player) + defence * placeScore(board, idx, opponent) }))
        .sort(byScoreDesc);
}

function winningMove(board, player, cells) {
    for (const idx of cells) {
        board[idx] = player;
        const wins = winLine(board, idx) !== null;
        board[idx] = 0;
        if (wins) return idx;
    }
    return -1;
}

/** Empty cells where `player` completes five. */
function winningCells(board, player, cells) {
    const wins = [];
    for (const idx of cells) {
        board[idx] = player;
        if (winLine(board, idx)) wins.push(idx);
        board[idx] = 0;
    }
    return wins;
}

/**
 * A cell from which `player` wins by making a four every move: each four can only be
 * answered at one cell, and the run ends in two ways to finish at once. -1 when there
 * is none within `depth` of its own moves. Leaves `board` as it found it.
 */
function forcedWin(board, player, depth) {
    if (depth === 0) return -1;
    const opponent = other(player);
    const cells = candidates(board);
    // If the other side can win right now, a four of ours is no threat to it.
    if (winningCells(board, opponent, cells).length) return -1;
    for (const idx of cells) {
        board[idx] = player;
        const wins = winningCells(board, player, candidates(board));
        let found = false;
        if (wins.length >= 2) found = true;
        else if (wins.length === 1) {
            board[wins[0]] = opponent;
            found = !winLine(board, wins[0]) && forcedWin(board, player, depth - 1) !== -1;
            board[wins[0]] = 0;
        }
        board[idx] = 0;
        if (found) return idx;
    }
    return -1;
}

/**
 * A cell for `player` to play. `easy` plays near the stones and sometimes misses a
 * threat; `medium` always sees a win or a four to stop and otherwise plays the
 * cell worth most; `hard` also plays out a run of fours that cannot be stopped when
 * it has one, and will not leave the other side one. `rng` is for the tests.
 */
export function chooseMove(board, player, level = 'medium', rng = Math.random) {
    const work = board.slice();
    const opponent = other(player);
    const near = candidates(work);

    // The first moves are a matter of taste, so they are drawn rather than worked
    // out: near the centre on a bare board, and one of the eight cells around a
    // lone stone as the reply. Every game then starts differently.
    const stones = work.reduce((n, cell) => n + (cell ? 1 : 0), 0);
    if (stones === 0) {
        const spots = [];
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) spots.push(at(7 + dr, 7 + dc));
        return spots[Math.floor(rng() * spots.length)];
    }
    if (stones === 1) {
        const lone = work.findIndex(Boolean);
        const row = Math.floor(lone / SIZE);
        const col = lone % SIZE;
        const around = [];
        for (const [dr, dc] of [...DIRS, ...DIRS.map(([r, c]) => [-r, -c])]) {
            if (inside(row + dr, col + dc)) around.push(at(row + dr, col + dc));
        }
        return around[Math.floor(rng() * around.length)];
    }

    // A win now, or the other side's win to stop, come before everything. Easy
    // takes its own win but lets the other side's through one time in three.
    const win = winningMove(work, player, near);
    if (win >= 0) return win;
    const block = winningMove(work, opponent, near);
    if (block >= 0 && (level !== 'easy' || rng() < 0.67)) return block;

    if (level === 'easy') {
        const pool = ranked(work, player, 0.3).slice(0, 8);
        return pool[Math.floor(rng() * pool.length)].idx;
    }
    if (level === 'medium') {
        const top = ranked(work, player, 0.95).slice(0, 5);
        // Near-equal cells are a coin toss, so the game is not the same twice.
        const pool = top.filter((c) => c.score >= top[0].score * 0.85);
        return pool[Math.floor(rng() * pool.length)].idx;
    }

    // hard
    const forced = forcedWin(work, player, 4);
    if (forced >= 0) return forced;
    const choices = ranked(work, player, 1).slice(0, 12);
    const safe = [];
    for (const choice of choices) {
        work[choice.idx] = player;
        const leavesOne = forcedWin(work, opponent, 4) !== -1;
        work[choice.idx] = 0;
        if (!leavesOne) safe.push(choice);
        // Only the first few safe cells matter: they are the ones worth drawing from.
        if (safe.length === 4) break;
    }
    if (safe.length === 0) return choices[0].idx;
    const pool = safe.filter((c) => c.score >= safe[0].score * 0.93);
    return pool[Math.floor(rng() * pool.length)].idx;
}
