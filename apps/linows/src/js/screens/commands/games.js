// /games: caro and cờ tướng (xiangqi) against a bot, to pass the time. The rules and
// the bots are in games/caro.js and games/xiangqi.js; this draws the boards and
// takes the clicks.

import * as caro from '../../games/caro.js';
import * as xq from '../../games/xiangqi.js';
import * as go from '../../games/go.js';

const LEVELS = ['easy', 'medium', 'hard'];
const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const STORE = 'look.games';
const SVG_NS = 'http://www.w3.org/2000/svg';
const BOT_DELAY_MS = 120;

const GAMES = {
    caro: {
        name: 'Caro',
        blurb: 'Five in a row on a 15 × 15 board',
        key: '1',
    },
    xiangqi: {
        name: 'Cờ tướng',
        blurb: 'Chinese chess: trap the other general',
        key: '2',
    },
    go: {
        name: 'Cờ vây',
        blurb: 'Go: surround territory. Also Atari Go and five in a row',
        key: '3',
    },
};

/** The ways to play on a Go board. `gomoku` is five in a row on the crossings (ngũ tử). */
const VARIANTS = [
    ['go', 'Go'],
    ['atari', 'Atari Go'],
    ['gomoku', 'Ngũ tử'],
];
const VARIANT_NAME = { go: 'Cờ vây', atari: 'Atari Go', gomoku: 'Ngũ tử' };
const SIZES = go.SIZES;
const SIDES = ['first', 'second', 'random'];
const SIDE_LABEL = { first: 'First', second: 'Second', random: 'Random' };

let panel = null;
let menuEl = null;
let playEl = null;
let boardEl = null;
let statusEl = null;
let titleEl = null;

let view = 'menu'; // 'menu' | a game id
let level = 'medium';
let side = 'first'; // which side the human takes: 'first', 'second' or 'random' (a toss each game)
let second = false; // the human plays second in the game now being set up
let variant = 'go'; // which game on the Go board
let boardSize = 9; // the Go board's size (ngũ tử is always 15)
let session = null; // the game in progress
let token = 0; // bumped when a game ends or restarts, so a late bot reply is dropped

// --- What is remembered between runs -----------------------------------------

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
        if (LEVELS.includes(saved.level)) level = saved.level;
        if (SIDES.includes(saved.side)) side = saved.side;
        else if (saved.second === true) side = 'second'; // from before there was a choice
        if (VARIANTS.some(([id]) => id === saved.variant)) variant = saved.variant;
        if (SIZES.includes(saved.boardSize)) boardSize = saved.boardSize;
    } catch {
        // private window or cleared site data: the defaults
    }
}

function save() {
    try {
        localStorage.setItem(STORE, JSON.stringify({ level, side, variant, boardSize }));
    } catch {
        // nothing to remember it in
    }
}

// --- The command panel's contract --------------------------------------------

export function init() {
    panel = document.getElementById('cmd-panel-games');
    menuEl = document.getElementById('games-menu');
    playEl = document.getElementById('games-play');
    boardEl = document.getElementById('games-board');
    statusEl = document.getElementById('games-status');
    titleEl = document.getElementById('games-title');
    load();

    document.getElementById('games-back').addEventListener('click', () => showMenu());
    document.getElementById('games-new').addEventListener('click', () => newGame());
    document.getElementById('games-undo').addEventListener('click', () => undo());
    document.getElementById('games-pass').addEventListener('click', () => session?.pass?.());
    document.getElementById('games-resign').addEventListener('click', () => session?.resign?.());
    document.getElementById('games-side').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-side]');
        if (button) setSide(button.dataset.side);
    });
    document.getElementById('games-size').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-board]');
        if (button) setBoard(Number(button.dataset.board));
    });
    document.getElementById('games-level').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-level]');
        if (button) setLevel(button.dataset.level);
    });
    menuEl.addEventListener('click', onMenuClick);
    renderMenu();
}

export function enter() {
    panel.hidden = false;
}

export function exit() {
    panel.hidden = true;
    // A bot still thinking has nobody to play for.
    token++;
}

export function handleKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (view === 'menu') {
        const game = Object.keys(GAMES).find((id) => GAMES[id].key === key);
        if (game) {
            start(game);
            return true;
        }
        if (key === 'l') {
            setLevel(LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length]);
            return true;
        }
        if (key === 's') {
            setSide(SIDES[(SIDES.indexOf(side) + 1) % SIDES.length]);
            return true;
        }
        if (key === 'v') {
            cycleVariant();
            return true;
        }
        if (key === 'b') {
            cycleBoard();
            return true;
        }
        return false; // Esc leaves command mode
    }
    if (key === 'p') {
        session?.pass?.();
        return true;
    }
    if (key === 'Escape') {
        showMenu();
        return true;
    }
    if (key === 'n') {
        newGame();
        return true;
    }
    if (key === 'u') {
        undo();
        return true;
    }
    if (key === 'l') {
        setLevel(LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length]);
        return true;
    }
    return false;
}

// --- The menu ----------------------------------------------------------------

function segment(options, current, attr) {
    return options
        .map(([value, label]) => `<button type="button" ${attr}="${value}" class="${value === current ? 'is-on' : ''}">${label}</button>`)
        .join('');
}

function renderMenu() {
    const cards = Object.entries(GAMES)
        .map(
            ([id, game]) =>
                `<button type="button" class="games-card" data-game="${id}">` +
                `<span class="games-card-art">${{ caro: caroArt, xiangqi: xiangqiArt, go: goArt }[id]()}</span>` +
                `<strong>${game.name}</strong><small>${game.blurb}</small>` +
                `<kbd>${game.key}</kbd></button>`,
        )
        .join('');
    menuEl.innerHTML =
        `<div class="games-cards">${cards}</div>` +
        `<div class="games-options">` +
        `<div class="games-opt"><span>Bot level</span><div class="games-seg" data-opt="level">${segment(
            LEVELS.map((l) => [l, LEVEL_LABEL[l]]),
            level,
            'data-level',
        )}</div><kbd>L</kbd></div>` +
        `<div class="games-opt"><span>You play</span><div class="games-seg" data-opt="side">${segment(
            SIDES.map((s) => [s, SIDE_LABEL[s]]),
            side,
            'data-side',
        )}</div><kbd>S</kbd><small>first is X, Red or Black; random is a toss each game</small></div>` +
        `<div class="games-opt"><span>Cờ vây</span><div class="games-seg" data-opt="variant">${segment(
            VARIANTS,
            variant,
            'data-variant',
        )}</div><kbd>V</kbd></div>` +
        `<div class="games-opt"><span>Board</span><div class="games-seg ${variant === 'gomoku' ? 'is-off' : ''}" data-opt="board">${segment(
            SIZES.map((n) => [n, `${n} × ${n}`]),
            boardSize,
            'data-board',
        )}</div><kbd>B</kbd>${variant === 'gomoku' ? '<small>ngũ tử is 15 × 15</small>' : ''}</div>` +
        `</div>` +
        `<p class="games-hint">Click a game or press its number. In a game: <kbd>N</kbd> new, <kbd>U</kbd> undo, <kbd>P</kbd> pass (cờ vây), <kbd>Esc</kbd> back.</p>`;
}

function cycleVariant() {
    const ids = VARIANTS.map(([id]) => id);
    variant = ids[(ids.indexOf(variant) + 1) % ids.length];
    save();
    renderMenu();
}

function cycleBoard() {
    boardSize = SIZES[(SIZES.indexOf(boardSize) + 1) % SIZES.length];
    save();
    renderMenu();
}

function onMenuClick(e) {
    const card = e.target.closest('[data-game]');
    if (card) return start(card.dataset.game);
    const variantButton = e.target.closest('[data-variant]');
    if (variantButton) {
        variant = variantButton.dataset.variant;
        save();
        return renderMenu();
    }
    const boardButton = e.target.closest('[data-board]');
    if (boardButton) {
        boardSize = Number(boardButton.dataset.board);
        save();
        return renderMenu();
    }
    const lvl = e.target.closest('[data-level]');
    if (lvl) return setLevel(lvl.dataset.level);
    const sideButton = e.target.closest('[data-side]');
    if (sideButton) setSide(sideButton.dataset.side);
}

function setSide(next) {
    if (!SIDES.includes(next)) return;
    side = next;
    save();
    if (view === 'menu') renderMenu();
    else newGame(); // a game already started is on the old side: begin again on the new one
}

function setLevel(next) {
    if (!LEVELS.includes(next)) return;
    level = next;
    save();
    if (view === 'menu') renderMenu();
    else markLevel();
}

function markLevel() {
    for (const button of document.querySelectorAll('#games-level button')) {
        button.classList.toggle('is-on', button.dataset.level === level);
    }
}

function showMenu() {
    token++;
    session = null;
    view = 'menu';
    playEl.hidden = true;
    menuEl.hidden = false;
    renderMenu();
}

// --- A game ------------------------------------------------------------------

function start(id) {
    view = id;
    menuEl.hidden = true;
    playEl.hidden = false;
    refreshBar();
    newGame();
}

/** What the bar above the board shows for the game being played. */
function refreshBar() {
    const goBoard = view === 'go';
    const stones = goBoard && variant !== 'gomoku';
    titleEl.textContent = goBoard ? `${VARIANT_NAME[variant]}${variant === 'gomoku' ? '' : ` ${boardSize}×${boardSize}`}` : GAMES[view].name;
    // Passing and resigning belong to the games with territory or captures.
    document.getElementById('games-pass').hidden = !stones || variant === 'atari';
    document.getElementById('games-resign').hidden = !stones;
    // The size only matters where there is a choice of it: not ngũ tử, always 15.
    document.getElementById('games-size').hidden = !stones;
    for (const button of document.querySelectorAll('#games-side button')) button.classList.toggle('is-on', button.dataset.side === side);
    for (const button of document.querySelectorAll('#games-size button')) {
        button.classList.toggle('is-on', Number(button.dataset.board) === boardSize);
    }
    markLevel();
}

function setBoard(next) {
    if (!SIZES.includes(next) || next === boardSize) return;
    boardSize = next;
    save();
    refreshBar();
    newGame();
}

function newGame() {
    if (view === 'menu') return;
    token++;
    // A toss for a random side, made afresh for every game.
    second = side === 'random' ? Math.random() < 0.5 : side === 'second';
    refreshBar();
    if (view === 'caro') session = newFiveInRow(false);
    else if (view === 'xiangqi') session = newXiangqi();
    else session = variant === 'gomoku' ? newFiveInRow(true) : newGo(variant === 'atari');
    session.draw();
    session.afterMove();
}

function undo() {
    if (!session || session.thinking) return;
    session.undo();
}

function say(text, tone = '') {
    statusEl.textContent = text;
    statusEl.dataset.tone = tone;
}

/** Runs `work` a beat later, so "thinking" is on screen before a slow bot freezes it. */
function later(my, work) {
    setTimeout(() => {
        if (my === token) work();
    }, BOT_DELAY_MS);
}

function el(name, attrs = {}, text) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
}

/** The SVG point an event landed on, in the board's own units. */
function pointOf(svg, e) {
    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
}

// --- Boards drawn on the crossings ---------------------------------------------

/** Where the star points sit on a board of this size (row, column). */
function starPoints(size) {
    if (size === 9)
        return [
            [2, 2],
            [2, 6],
            [6, 2],
            [6, 6],
            [4, 4],
        ];
    if (size === 15)
        return [
            [3, 3],
            [3, 11],
            [11, 3],
            [11, 11],
            [7, 7],
        ];
    const lines = size === 13 ? [3, 6, 9] : [3, 9, 15];
    return lines.flatMap((r) => lines.map((c) => [r, c]));
}

/** The shading for the stones, once per board. */
function goDefs(svg) {
    const defs = el('defs');
    const shade = (id, stops) => {
        const gradient = el('radialGradient', { id, cx: '36%', cy: '34%', r: '75%' });
        for (const [offset, color] of stops) gradient.appendChild(el('stop', { offset, 'stop-color': color }));
        defs.appendChild(gradient);
    };
    shade('go-b', [
        ['0%', '#6a6a6a'],
        ['55%', '#1a1a1a'],
        ['100%', '#000'],
    ]);
    shade('go-w', [
        ['0%', '#fff'],
        ['60%', '#e9e9e9'],
        ['100%', '#b4b4b4'],
    ]);
    svg.appendChild(defs);
}

/** The wood, the lines and the star points of a `size` board played on the crossings. */
function drawCrossings(svg, size, cell, pad) {
    const span = (size - 1) * cell + pad * 2;
    svg.appendChild(el('rect', { x: 0, y: 0, width: span, height: span, rx: 10, class: 'go-bg' }));
    const far = pad + (size - 1) * cell;
    for (let i = 0; i < size; i++) {
        const p = pad + i * cell;
        svg.appendChild(el('line', { x1: pad, y1: p, x2: far, y2: p, class: 'go-line' }));
        svg.appendChild(el('line', { x1: p, y1: pad, x2: p, y2: far, class: 'go-line' }));
    }
    for (const [r, c] of starPoints(size)) {
        svg.appendChild(el('circle', { cx: pad + c * cell, cy: pad + r * cell, r: 3.2, class: 'go-star' }));
    }
}

/** A stone: 1 is black, 2 is white. */
const stoneEl = (cx, cy, r, color, extra = '') =>
    el('circle', { cx, cy, r, class: `go-stone ${color === 1 ? 'is-black' : 'is-white'} ${extra}`.trim() });

// --- Caro and ngũ tử -------------------------------------------------------------

// Caro is played in the squares of a 15 x 15 grid. Ngũ tử is the same game on the
// crossings of a Go board, with Go stones. The rules and the bots are the same.
const FIVE = caro.SIZE;

function newFiveInRow(crossings) {
    const cell = crossings ? 30 : 32;
    const pad = crossings ? 26 : 14;
    const span = crossings ? (FIVE - 1) * cell + pad * 2 : FIVE * cell + pad * 2;
    const human = second ? 2 : 1;
    const bot = caro.other(human);
    const names = crossings ? ['Black', 'White'] : ['X', 'O'];
    const board = caro.emptyBoard();
    const moves = []; // cell indexes in order, the bot's and the human's
    let over = false;
    let win = null;
    let turn = 1;

    const svg = el('svg', {
        viewBox: `0 0 ${span} ${span}`,
        class: 'games-svg',
        role: 'img',
        'aria-label': crossings ? 'Five in a row on a Go board' : 'Caro board',
    });
    boardEl.replaceChildren(svg);
    const layer = el('g');
    const tint = el('g');

    /** The middle of a square, or the crossing itself. */
    const xy = (idx) => {
        const col = idx % FIVE;
        const row = Math.floor(idx / FIVE);
        return crossings ? [pad + col * cell, pad + row * cell] : [pad + (col + 0.5) * cell, pad + (row + 0.5) * cell];
    };

    function drawSquares() {
        svg.appendChild(el('rect', { x: 0, y: 0, width: span, height: span, rx: 10, class: 'caro-bg' }));
        // One more line than squares each way, so the lines close every square.
        for (let i = 0; i <= FIVE; i++) {
            const p = pad + i * cell;
            const far = pad + FIVE * cell;
            svg.appendChild(el('line', { x1: pad, y1: p, x2: far, y2: p, class: 'caro-line' }));
            svg.appendChild(el('line', { x1: p, y1: pad, x2: p, y2: far, class: 'caro-line' }));
        }
        // The tint of the last move and of the winning five goes under the lines.
        tint.replaceChildren();
        svg.insertBefore(tint, svg.children[1]);
        const half = cell / 2;
        const last = moves[moves.length - 1];
        for (const idx of win ?? []) {
            const [x, y] = xy(idx);
            tint.appendChild(el('rect', { x: x - half, y: y - half, width: cell, height: cell, class: 'caro-win' }));
        }
        if (last !== undefined && !win) {
            const [x, y] = xy(last);
            tint.appendChild(el('rect', { x: x - half, y: y - half, width: cell, height: cell, class: 'caro-last' }));
        }
    }

    const game = {
        thinking: false,
        draw() {
            svg.replaceChildren();
            if (crossings) {
                goDefs(svg);
                drawCrossings(svg, FIVE, cell, pad);
            } else drawSquares();
            layer.replaceChildren();
            svg.appendChild(layer);
            for (let idx = 0; idx < board.length; idx++) {
                if (!board[idx]) continue;
                const [x, y] = xy(idx);
                if (crossings) layer.appendChild(stoneEl(x, y, cell * 0.46, board[idx]));
                else if (board[idx] === 1) {
                    layer.appendChild(el('path', { d: `M${x - 9} ${y - 9}L${x + 9} ${y + 9}M${x + 9} ${y - 9}L${x - 9} ${y + 9}`, class: 'caro-x' }));
                } else layer.appendChild(el('circle', { cx: x, cy: y, r: 10, class: 'caro-o' }));
            }
            if (crossings) {
                const last = moves[moves.length - 1];
                if (last !== undefined && !win) {
                    const [x, y] = xy(last);
                    layer.appendChild(el('circle', { cx: x, cy: y, r: 4.5, class: `go-last ${board[last] === 1 ? 'on-black' : 'on-white'}` }));
                }
                for (const idx of win ?? []) {
                    const [x, y] = xy(idx);
                    layer.appendChild(el('circle', { cx: x, cy: y, r: cell * 0.56, class: 'go-win-ring' }));
                }
            }
        },
        click(e) {
            if (over || game.thinking || turn !== human) return;
            const p = pointOf(svg, e);
            const round = crossings ? Math.round : Math.floor;
            const col = round((p.x - pad) / cell);
            const row = round((p.y - pad) / cell);
            if (col < 0 || row < 0 || col >= FIVE || row >= FIVE) return;
            const idx = row * FIVE + col;
            if (board[idx]) return;
            play(idx);
        },
        undo() {
            if (over || moves.length === 0) return;
            // Back to the human's turn: the bot's reply goes, then the human's move.
            while (moves.length && turn !== human) pop();
            if (moves.length) pop();
            while (moves.length && turn !== human) pop();
            win = null;
            over = false;
            game.draw();
            game.afterMove();
        },
        afterMove() {
            if (over) return;
            if (turn === human) {
                say(`Your move (${names[human - 1]})`);
                return;
            }
            game.thinking = true;
            say('Bot is thinking…', 'busy');
            const my = token;
            later(my, () => {
                const idx = caro.chooseMove(board, bot, level);
                game.thinking = false;
                play(idx);
            });
        },
    };

    function pop() {
        const idx = moves.pop();
        board[idx] = 0;
        turn = caro.other(turn);
    }

    function play(idx) {
        board[idx] = turn;
        moves.push(idx);
        win = caro.winLine(board, idx);
        if (win) {
            over = true;
            const mine = turn === human;
            game.draw();
            say(mine ? 'You win!' : 'The bot wins', mine ? 'win' : 'lose');
            return;
        }
        if (caro.isFull(board)) {
            over = true;
            game.draw();
            say('A draw', 'draw');
            return;
        }
        turn = caro.other(turn);
        game.draw();
        game.afterMove();
    }

    svg.addEventListener('click', game.click);
    return game;
}

// --- Cờ vây and Atari Go ---------------------------------------------------------

function newGo(atari) {
    const size = boardSize;
    const cell = size === 9 ? 44 : size === 13 ? 34 : 24;
    const pad = 28;
    const human = second ? go.WHITE : go.BLACK;
    const bot = go.other(human);
    const colorName = (c) => (c === go.BLACK ? 'Black' : 'White');
    let pos = new go.Position(size, atari ? 1 : 0);
    const stack = []; // the position before each move, to take moves back
    let over = false;
    let settled = null; // the count at the end, once there is one
    let note = ''; // what just happened that the player should know

    const svg = el('svg', { viewBox: `0 0 ${(size - 1) * cell + pad * 2} ${(size - 1) * cell + pad * 2}`, class: 'games-svg', role: 'img', 'aria-label': 'Go board' });
    boardEl.replaceChildren(svg);
    const xy = (idx) => [pad + (idx % size) * cell, pad + Math.floor(idx / size) * cell];

    const game = {
        thinking: false,
        draw() {
            svg.replaceChildren();
            goDefs(svg);
            drawCrossings(svg, size, cell, pad);
            const dead = new Set(settled?.dead ?? []);
            // Territory, when the game is counted: a small square on each point that is someone's.
            if (settled) {
                const side = cell * 0.34;
                for (let idx = 0; idx < pos.n; idx++) {
                    const owner = settled.owners[idx];
                    if (!owner || (pos.board[idx] !== go.EMPTY && !dead.has(idx))) continue;
                    const [x, y] = xy(idx);
                    svg.appendChild(el('rect', { x: x - side / 2, y: y - side / 2, width: side, height: side, class: `go-terr ${owner === go.BLACK ? 'is-black' : 'is-white'}` }));
                }
            }
            for (let idx = 0; idx < pos.n; idx++) {
                const color = pos.board[idx];
                if (!color) continue;
                const [x, y] = xy(idx);
                svg.appendChild(stoneEl(x, y, cell * 0.47, color, dead.has(idx) ? 'is-dead' : ''));
            }
            if (pos.last >= 0 && !settled) {
                const [x, y] = xy(pos.last);
                svg.appendChild(el('circle', { cx: x, cy: y, r: cell * 0.14, class: `go-last ${pos.board[pos.last] === go.BLACK ? 'on-black' : 'on-white'}` }));
            }
            if (pos.ko >= 0 && !over) {
                const [x, y] = xy(pos.ko);
                const half = cell * 0.17;
                svg.appendChild(el('rect', { x: x - half, y: y - half, width: half * 2, height: half * 2, class: 'go-ko' }));
            }
        },
        click(e) {
            if (over || game.thinking || pos.toPlay !== human) return;
            const p = pointOf(svg, e);
            const col = Math.round((p.x - pad) / cell);
            const row = Math.round((p.y - pad) / cell);
            if (col < 0 || row < 0 || col >= size || row >= size) return;
            const idx = row * size + col;
            if (pos.board[idx]) return;
            if (!pos.isLegal(idx)) {
                // Either the ko rule or a stone with no liberties; say which is likelier.
                say(idx === pos.ko ? 'Ko: you may not retake straight away' : 'Not allowed there: no liberties', 'warn');
                return;
            }
            stack.push(pos.clone());
            note = '';
            pos.play(idx);
            game.draw();
            game.afterMove();
        },
        pass() {
            if (over || game.thinking || pos.toPlay !== human || atari) return;
            stack.push(pos.clone());
            pos.pass();
            note = '';
            game.draw();
            game.afterMove();
        },
        resign() {
            if (over) return;
            over = true;
            token++;
            game.thinking = false;
            say('You resigned. The bot wins', 'lose');
        },
        undo() {
            if (game.thinking || stack.length === 0) return;
            // Back to the human's turn: the bot's reply goes, then the human's move.
            do pos = stack.pop();
            while (stack.length && pos.toPlay !== human);
            settled = null;
            over = false;
            note = '';
            game.draw();
            game.afterMove();
        },
        afterMove() {
            const winner = pos.captureWinner();
            if (winner) {
                over = true;
                say(winner === human ? 'You win: the first capture!' : 'The bot captured first', winner === human ? 'win' : 'lose');
                return;
            }
            if (pos.over) {
                if (atari) {
                    over = true;
                    say('Nothing was captured: a draw', 'draw');
                } else finish();
                return;
            }
            const taken = `captured ${pos.captured[human]}–${pos.captured[bot]}`;
            if (pos.toPlay === human) {
                const head = atari ? 'First capture wins. ' : '';
                say(`${note}${head}Your move (${colorName(human)}), ${taken}`);
                return;
            }
            game.thinking = true;
            say(`Bot is thinking… ${taken}`, 'busy');
            const my = token;
            later(my, () => {
                const move = go.chooseMove(pos, level);
                game.thinking = false;
                stack.push(pos.clone());
                if (move === go.PASS) {
                    pos.pass();
                    note = 'The bot passed. ';
                } else {
                    pos.play(move);
                    note = '';
                }
                game.draw();
                game.afterMove();
            });
        },
    };

    /** Both passed: play the position out at random to see which stones live, then count. */
    function finish() {
        over = true;
        say('Counting…', 'busy');
        const my = token;
        later(my, () => {
            const runs = size === 9 ? 240 : size === 13 ? 140 : 70;
            settled = go.settle(pos, go.ownership(pos, Math.random, runs));
            const mine = settled.winner === human;
            const by = Math.abs(settled.margin).toFixed(1);
            game.draw();
            say(
                `${mine ? 'You win' : 'The bot wins'} by ${by}  ·  Black ${settled.black}, White ${settled.white - settled.komi} + ${settled.komi} komi`,
                mine ? 'win' : 'lose',
            );
        });
    }

    svg.addEventListener('click', game.click);
    return game;
}

// --- Cờ tướng ----------------------------------------------------------------

const XQ_CELL = 52;
const XQ_PAD = 38;
const XQ_W = (xq.COLS - 1) * XQ_CELL + XQ_PAD * 2;
const XQ_H = (xq.ROWS - 1) * XQ_CELL + XQ_PAD * 2;

function newXiangqi() {
    const human = second ? xq.BLACK : xq.RED;
    const bot = -human;
    const board = xq.initialBoard();
    const history = []; // { move, captured, side }
    let turn = xq.RED;
    let selected = -1;
    let targets = [];
    let over = false;
    let checked = false;

    // The human always sits at the bottom, so a black player sees the board turned round.
    const flip = human === xq.BLACK;
    const place = (idx) => {
        const row = flip ? xq.ROWS - 1 - xq.rowOf(idx) : xq.rowOf(idx);
        const col = flip ? xq.COLS - 1 - xq.colOf(idx) : xq.colOf(idx);
        return [XQ_PAD + col * XQ_CELL, XQ_PAD + row * XQ_CELL];
    };

    const svg = el('svg', { viewBox: `0 0 ${XQ_W} ${XQ_H}`, class: 'games-svg', role: 'img', 'aria-label': 'Xiangqi board' });
    boardEl.replaceChildren(svg);

    function drawGrid() {
        svg.appendChild(el('rect', { x: 0, y: 0, width: XQ_W, height: XQ_H, rx: 10, class: 'xq-bg' }));
        const left = XQ_PAD;
        const right = XQ_PAD + (xq.COLS - 1) * XQ_CELL;
        const rowY = (r) => XQ_PAD + r * XQ_CELL;
        const colX = (c) => XQ_PAD + c * XQ_CELL;
        for (let r = 0; r < xq.ROWS; r++) svg.appendChild(el('line', { x1: left, y1: rowY(r), x2: right, y2: rowY(r), class: 'xq-line' }));
        for (let c = 0; c < xq.COLS; c++) {
            if (c === 0 || c === xq.COLS - 1) {
                svg.appendChild(el('line', { x1: colX(c), y1: rowY(0), x2: colX(c), y2: rowY(9), class: 'xq-line' }));
            } else {
                // The river interrupts every file but the two edges.
                svg.appendChild(el('line', { x1: colX(c), y1: rowY(0), x2: colX(c), y2: rowY(4), class: 'xq-line' }));
                svg.appendChild(el('line', { x1: colX(c), y1: rowY(5), x2: colX(c), y2: rowY(9), class: 'xq-line' }));
            }
        }
        for (const [top, bottom] of [
            [0, 2],
            [7, 9],
        ]) {
            svg.appendChild(el('line', { x1: colX(3), y1: rowY(top), x2: colX(5), y2: rowY(bottom), class: 'xq-line' }));
            svg.appendChild(el('line', { x1: colX(5), y1: rowY(top), x2: colX(3), y2: rowY(bottom), class: 'xq-line' }));
        }
        svg.appendChild(el('rect', { x: left - 5, y: rowY(0) - 5, width: right - left + 10, height: rowY(9) - rowY(0) + 10, class: 'xq-frame' }));
        const mid = (rowY(4) + rowY(5)) / 2;
        svg.appendChild(el('text', { x: colX(2), y: mid, class: 'xq-river' }, '楚 河'));
        svg.appendChild(el('text', { x: colX(6), y: mid, class: 'xq-river' }, '漢 界'));
    }

    function drawPieces() {
        const lastMove = history[history.length - 1];
        if (lastMove) {
            for (const idx of [xq.moveFrom(lastMove.move), xq.moveTo(lastMove.move)]) {
                const [x, y] = place(idx);
                svg.appendChild(el('rect', { x: x - 24, y: y - 24, width: 48, height: 48, rx: 8, class: 'xq-last' }));
            }
        }
        for (let idx = 0; idx < 90; idx++) {
            const piece = board[idx];
            if (!piece) continue;
            const side = xq.sideOf(piece);
            const [x, y] = place(idx);
            const group = el('g', { class: `xq-piece ${side === xq.RED ? 'is-red' : 'is-black'}` });
            if (idx === selected) group.appendChild(el('circle', { cx: x, cy: y, r: 29, class: 'xq-selected' }));
            if (checked && xq.kindOf(piece) === xq.KING && side === turn) {
                group.appendChild(el('circle', { cx: x, cy: y, r: 29, class: 'xq-check' }));
            }
            group.appendChild(el('circle', { cx: x, cy: y, r: 23, class: 'xq-disc' }));
            group.appendChild(el('circle', { cx: x, cy: y, r: 19, class: 'xq-ring' }));
            const char = el('text', { x, y: y + 1, class: 'xq-char' }, xq.PIECE_CHARS[side][xq.kindOf(piece)]);
            // As on a real board, the other player's pieces are written to face them.
            if (side !== human) char.setAttribute('transform', `rotate(180 ${x} ${y})`);
            group.appendChild(char);
            svg.appendChild(group);
        }
        for (const idx of targets) {
            const [x, y] = place(idx);
            svg.appendChild(el('circle', { cx: x, cy: y, r: board[idx] ? 26 : 7, class: board[idx] ? 'xq-capture' : 'xq-dot' }));
        }
    }

    const game = {
        thinking: false,
        draw() {
            svg.replaceChildren();
            drawGrid();
            drawPieces();
        },
        click(e) {
            if (over || game.thinking || turn !== human) return;
            const p = pointOf(svg, e);
            let col = Math.round((p.x - XQ_PAD) / XQ_CELL);
            let row = Math.round((p.y - XQ_PAD) / XQ_CELL);
            if (col < 0 || row < 0 || col >= xq.COLS || row >= xq.ROWS) return;
            if (flip) {
                col = xq.COLS - 1 - col;
                row = xq.ROWS - 1 - row;
            }
            const idx = row * xq.COLS + col;
            if (selected >= 0 && targets.includes(idx)) {
                play(xq.makeMove(selected, idx));
                return;
            }
            if (xq.sideOf(board[idx]) === human) {
                selected = idx;
                targets = xq.legalMovesFrom(board, human, idx);
            } else {
                selected = -1;
                targets = [];
            }
            game.draw();
        },
        undo() {
            if (history.length === 0 || game.thinking) return;
            // Back to the human's turn: the bot's reply goes, then the human's move.
            while (history.length && turn !== human) pop();
            if (history.length) pop();
            while (history.length && turn !== human) pop();
            selected = -1;
            targets = [];
            over = false;
            checked = xq.inCheck(board, turn);
            game.draw();
            game.afterMove();
        },
        afterMove() {
            const result = xq.status(board, turn);
            checked = result.check;
            if (result.moves.length === 0) {
                over = true;
                game.draw();
                const mine = turn === bot;
                const how = result.state === 'checkmate' ? 'Checkmate' : 'No moves left';
                say(mine ? `${how}. You win!` : `${how}. The bot wins`, mine ? 'win' : 'lose');
                return;
            }
            if (turn === human) {
                say(checked ? 'Check! Your move' : `Your move (${human === xq.RED ? 'Red' : 'Black'})`, checked ? 'warn' : '');
                game.draw();
                return;
            }
            game.thinking = true;
            say(checked ? 'Check. Bot is thinking…' : 'Bot is thinking…', 'busy');
            game.draw();
            const my = token;
            later(my, () => {
                const move = xq.chooseMove(board, bot, level);
                game.thinking = false;
                if (move !== null) play(move);
            });
        },
    };

    function pop() {
        const { move, captured, side } = history.pop();
        xq.undoMove(board, move, captured);
        turn = side;
    }

    function play(move) {
        const captured = xq.applyMove(board, move);
        history.push({ move, captured, side: turn });
        turn = -turn;
        selected = -1;
        targets = [];
        game.afterMove();
    }

    svg.addEventListener('click', game.click);
    return game;
}

// --- Small pictures for the menu ---------------------------------------------

function caroArt() {
    return (
        '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">' +
        '<rect width="64" height="64" rx="10" class="caro-bg"/>' +
        '<path d="M16 8V56M32 8V56M48 8V56M8 16H56M8 32H56M8 48H56" class="caro-line"/>' +
        '<path d="M11 11L21 21M21 11L11 21" class="caro-x"/><circle cx="32" cy="32" r="6" class="caro-o"/>' +
        '<path d="M43 43L53 53M53 43L43 53" class="caro-x"/></svg>'
    );
}

function goArt() {
    return (
        '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">' +
        '<rect width="64" height="64" rx="10" class="go-bg"/>' +
        '<path d="M14 12V52M32 12V52M50 12V52M12 14H52M12 32H52M12 50H52" class="go-line"/>' +
        '<circle cx="32" cy="32" r="3" class="go-star"/>' +
        '<circle cx="23" cy="23" r="8.5" class="go-art-b"/><circle cx="41" cy="41" r="8.5" class="go-art-w"/>' +
        '<circle cx="41" cy="23" r="8.5" class="go-art-w"/></svg>'
    );
}

function xiangqiArt() {
    return (
        '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">' +
        '<rect width="64" height="64" rx="10" class="xq-bg"/>' +
        '<circle cx="32" cy="32" r="22" class="xq-disc"/><circle cx="32" cy="32" r="18" class="xq-ring is-red-ring"/>' +
        '<text x="32" y="33" class="xq-char xq-art-char">帥</text></svg>'
    );
}
