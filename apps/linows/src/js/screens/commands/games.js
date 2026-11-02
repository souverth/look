// /games: caro and cờ tướng (xiangqi) against a bot, to pass the time. The rules and
// the bots are in games/caro.js and games/xiangqi.js; this draws the boards and
// takes the clicks.

import * as caro from '../../games/caro.js';
import * as xq from '../../games/xiangqi.js';

const LEVELS = ['easy', 'medium', 'hard'];
const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const STORE = 'look.games';
const SVG_NS = 'http://www.w3.org/2000/svg';
const BOT_DELAY_MS = 120;

const GAMES = {
    caro: {
        name: 'Caro',
        blurb: 'Five in a row on a 15 × 15 board',
        sides: ['X, you start', 'O, bot starts'],
        key: '1',
    },
    xiangqi: {
        name: 'Cờ tướng',
        blurb: 'Chinese chess: trap the other general',
        sides: ['Red, you start', 'Black, bot starts'],
        key: '2',
    },
};

let panel = null;
let menuEl = null;
let playEl = null;
let boardEl = null;
let statusEl = null;
let titleEl = null;

let view = 'menu'; // 'menu' | a game id
let level = 'medium';
let second = false; // the human plays second
let session = null; // the game in progress
let token = 0; // bumped when a game ends or restarts, so a late bot reply is dropped

// --- What is remembered between runs -----------------------------------------

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
        if (LEVELS.includes(saved.level)) level = saved.level;
        second = saved.second === true;
    } catch {
        // private window or cleared site data: the defaults
    }
}

function save() {
    try {
        localStorage.setItem(STORE, JSON.stringify({ level, second }));
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
            second = !second;
            save();
            renderMenu();
            return true;
        }
        return false; // Esc leaves command mode
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
                `<span class="games-card-art">${id === 'caro' ? caroArt() : xiangqiArt()}</span>` +
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
            [
                ['first', 'First'],
                ['second', 'Second'],
            ],
            second ? 'second' : 'first',
            'data-side',
        )}</div><kbd>S</kbd></div>` +
        `</div>` +
        `<p class="games-hint">Click a game or press its number. In a game: <kbd>N</kbd> new, <kbd>U</kbd> undo, <kbd>Esc</kbd> back.</p>`;
}

function onMenuClick(e) {
    const card = e.target.closest('[data-game]');
    if (card) return start(card.dataset.game);
    const lvl = e.target.closest('[data-level]');
    if (lvl) return setLevel(lvl.dataset.level);
    const side = e.target.closest('[data-side]');
    if (side) {
        second = side.dataset.side === 'second';
        save();
        renderMenu();
    }
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
    titleEl.textContent = GAMES[id].name;
    markLevel();
    newGame();
}

function newGame() {
    if (view === 'menu') return;
    token++;
    session = view === 'caro' ? newCaro() : newXiangqi();
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

// --- Caro --------------------------------------------------------------------

// Caro is played in the squares, not on the crossings: a 15 x 15 grid of cells.
const CARO_CELL = 32;
const CARO_PAD = 14;
const CARO_SPAN = caro.SIZE * CARO_CELL + CARO_PAD * 2;

function newCaro() {
    const human = second ? 2 : 1;
    const bot = caro.other(human);
    const board = caro.emptyBoard();
    const moves = []; // cell indexes in order, the bot's and the human's
    let over = false;
    let win = null;
    let turn = 1;

    const svg = el('svg', { viewBox: `0 0 ${CARO_SPAN} ${CARO_SPAN}`, class: 'games-svg', role: 'img', 'aria-label': 'Caro board' });
    boardEl.replaceChildren(svg);
    const layer = el('g');
    const tint = el('g');

    /** The middle of a cell. */
    const xy = (idx) => [
        CARO_PAD + ((idx % caro.SIZE) + 0.5) * CARO_CELL,
        CARO_PAD + (Math.floor(idx / caro.SIZE) + 0.5) * CARO_CELL,
    ];

    const game = {
        thinking: false,
        draw() {
            svg.replaceChildren();
            svg.appendChild(el('rect', { x: 0, y: 0, width: CARO_SPAN, height: CARO_SPAN, rx: 10, class: 'caro-bg' }));
            // One more line than cells each way, so the lines close every square.
            for (let i = 0; i <= caro.SIZE; i++) {
                const p = CARO_PAD + i * CARO_CELL;
                const far = CARO_PAD + caro.SIZE * CARO_CELL;
                svg.appendChild(el('line', { x1: CARO_PAD, y1: p, x2: far, y2: p, class: 'caro-line' }));
                svg.appendChild(el('line', { x1: p, y1: CARO_PAD, x2: p, y2: far, class: 'caro-line' }));
            }
            // The tint of the last move and of the winning five goes under the lines.
            tint.replaceChildren();
            svg.insertBefore(tint, svg.children[1]);
            layer.replaceChildren();
            svg.appendChild(layer);
            const half = CARO_CELL / 2;
            const last = moves[moves.length - 1];
            for (const idx of win ?? []) {
                const [x, y] = xy(idx);
                tint.appendChild(el('rect', { x: x - half, y: y - half, width: CARO_CELL, height: CARO_CELL, class: 'caro-win' }));
            }
            if (last !== undefined && !win) {
                const [x, y] = xy(last);
                tint.appendChild(el('rect', { x: x - half, y: y - half, width: CARO_CELL, height: CARO_CELL, class: 'caro-last' }));
            }
            for (let idx = 0; idx < board.length; idx++) {
                if (!board[idx]) continue;
                const [x, y] = xy(idx);
                if (board[idx] === 1) {
                    layer.appendChild(el('path', { d: `M${x - 9} ${y - 9}L${x + 9} ${y + 9}M${x + 9} ${y - 9}L${x - 9} ${y + 9}`, class: 'caro-x' }));
                } else {
                    layer.appendChild(el('circle', { cx: x, cy: y, r: 10, class: 'caro-o' }));
                }
            }
        },
        click(e) {
            if (over || game.thinking || turn !== human) return;
            const p = pointOf(svg, e);
            const col = Math.floor((p.x - CARO_PAD) / CARO_CELL);
            const row = Math.floor((p.y - CARO_PAD) / CARO_CELL);
            if (col < 0 || row < 0 || col >= caro.SIZE || row >= caro.SIZE) return;
            const idx = row * caro.SIZE + col;
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
                say(`Your move (${human === 1 ? 'X' : 'O'})`);
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

function xiangqiArt() {
    return (
        '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">' +
        '<rect width="64" height="64" rx="10" class="xq-bg"/>' +
        '<circle cx="32" cy="32" r="22" class="xq-disc"/><circle cx="32" cy="32" r="18" class="xq-ring is-red-ring"/>' +
        '<text x="32" y="33" class="xq-char xq-art-char">帥</text></svg>'
    );
}
