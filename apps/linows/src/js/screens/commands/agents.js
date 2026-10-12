// /agents: which coding agents are installed on this machine and how much of
// their quota is used. Detection and usage come from the shared look-agents
// crate. By default everything is read from the agents' own local files; the
// "Live quota" toggle additionally asks each vendor for the plan's real limits
// (Codex through its own app-server, Claude through its usage endpoint). The
// latest numbers also feed the home hint-bar widget (see setOnQuickChange).

import { agentsStatus, getConfig, setConfig } from '../../ipc.js';
import { bot, refreshCw, zap } from '../../icons.js';
import { escapeHtml } from '../../markdown.js';
import { agentLogo } from '../../agent-logos.js';

const CONFIG_KEY = 'agents_live_quota';
const BACKGROUND_REFRESH_MS = 5 * 60 * 1000;
const WARN_PERCENT = 60;
const DANGER_PERCENT = 85;

// --- State ---
let statuses = [];
let useApi = false;
let configLoaded = false;
let loading = false;
let loadedOnce = false;
let visible = false;
const quickListeners = [];
let latestQuick = null;
let timer = null;

// --- DOM refs ---
let panel, listEl, countEl, liveBtn, refreshBtn;

export function init() {
    panel = document.getElementById('cmd-panel-agents');
    listEl = document.getElementById('cmd-agents-list');
    countEl = document.getElementById('cmd-agents-count');
    liveBtn = document.getElementById('cmd-agents-live-btn');
    refreshBtn = document.getElementById('cmd-agents-refresh-btn');

    refreshBtn.innerHTML = `${refreshCw} Refresh`;
    liveBtn.addEventListener('click', toggleLive);
    refreshBtn.addEventListener('click', () => refresh());
    renderToolbar();
    // Nothing is read until something shows it: see `hold` and `enter`.
}

// Scanning the agents' logs (and asking vendors, with Live quota on) is only
// worth doing while someone looks at the result: this panel, or an Agents tile
// on the Super Actions strip. Each holder says so by name; the first starts the
// background refresh and the last to let go stops it.
const holders = new Set();

export function hold(who, on) {
    if (on) holders.add(who);
    else holders.delete(who);
    syncBackground();
}

function syncBackground() {
    const needed = visible || holders.size > 0;
    if (needed && !timer) {
        void refresh({ quiet: true });
        timer = setInterval(() => refresh({ quiet: true }), BACKGROUND_REFRESH_MS);
    } else if (!needed && timer) {
        clearInterval(timer);
        timer = null;
    }
}

export function enter() {
    visible = true;
    panel.hidden = false;
    render();
    void refresh();
    syncBackground();
}

export function exit() {
    visible = false;
    panel.hidden = true;
    syncBackground();
}

export function handleKey(e) {
    if (!visible || e.ctrlKey || e.metaKey || e.altKey) return false;
    const key = e.key.toLowerCase();
    if (key === 'r') {
        e.preventDefault();
        void refresh();
        return true;
    }
    if (key === 'l') {
        e.preventDefault();
        void toggleLive();
        return true;
    }
    return false;
}

// Re-read when the launcher is summoned; the numbers move while it is hidden.
export function refreshQuiet() {
    // Only while something is showing agents; otherwise there is nothing to keep fresh.
    return timer ? refresh({ quiet: true }) : Promise.resolve();
}

// Every surface that shows agent usage (the hint bar, the Agents widget) hears
// each refresh; a late subscriber is brought up to date at once.
export function setOnQuickChange(fn) {
    quickListeners.push(fn);
    if (loadedOnce && latestQuick) fn(latestQuick);
}

// The latest summary, or null before the first read.
export function getQuick() {
    return latestQuick;
}

// --- Data ---

async function ensureConfig() {
    if (configLoaded) return;
    try {
        const cfg = await getConfig();
        useApi = cfg.entries.some((e) => e.key === CONFIG_KEY && e.value === 'true');
    } catch (err) {
        console.error('[agents] config read failed:', err);
    }
    configLoaded = true;
}

async function refresh({ quiet = false } = {}) {
    if (loading) return;
    loading = true;
    if (!quiet && visible) renderToolbar();
    try {
        await ensureConfig();
        // Minutes east of UTC; Date reports the opposite sign.
        statuses = await agentsStatus(useApi, -new Date().getTimezoneOffset());
        loadedOnce = true;
    } catch (err) {
        console.error('[agents] status failed:', err);
        if (visible) listEl.innerHTML = `<div class="cmd-agents-empty">Couldn't read agents: ${escapeHtml(String(err))}</div>`;
    } finally {
        loading = false;
    }
    fireQuickChange();
    if (visible) render();
}

async function toggleLive() {
    await ensureConfig();
    useApi = !useApi;
    renderToolbar();
    try {
        await setConfig([{ key: CONFIG_KEY, value: String(useApi) }]);
    } catch (err) {
        console.error('[agents] config write failed:', err);
    }
    // A fresh read, bypassing nothing: the backend caches live answers for a
    // minute, and turning the switch off must drop them from view at once.
    void refresh();
}

// --- Widget summary ---

// One entry per installed agent that has something to show, tightest first:
// { id, name, percent, label, meters, tokens5h }.
function fireQuickChange() {
    const items = statuses
        .filter((s) => s.installed)
        .map((s) => {
            const live = s.meters.filter((m) => !m.stale);
            const worst = live.reduce((a, m) => (a && a.used_percent >= m.used_percent ? a : m), null);
            const five = s.windows[0];
            return {
                id: s.id,
                name: s.name,
                percent: worst ? Math.round(worst.used_percent) : null,
                label: worst?.label ?? null,
                meters: s.meters,
                tokens5h: five ? five.input + five.output : 0,
            };
        })
        .filter((i) => i.percent !== null || i.tokens5h > 0)
        .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || b.tokens5h - a.tokens5h);
    latestQuick = { items, useApi };
    for (const fn of quickListeners) fn(latestQuick);
}

export { formatTokens, levelOf, formatReset };

// --- Rendering ---

function renderToolbar() {
    if (!liveBtn) return;
    liveBtn.innerHTML = `${zap} Live quota: ${useApi ? 'On' : 'Off'}`;
    liveBtn.classList.toggle('cmd-todo-btn-dirty', useApi);
    refreshBtn.disabled = loading;
}

function render() {
    renderToolbar();
    const installed = statuses.filter((s) => s.installed);
    const missing = statuses.filter((s) => !s.installed);
    countEl.innerHTML = loadedOnce
        ? `${bot} ${installed.length} detected`
        : `${bot} Scanning…`;
    if (!loadedOnce) {
        listEl.innerHTML = '<div class="cmd-agents-empty">Looking for agents on this machine…</div>';
        return;
    }
    listEl.innerHTML =
        installed.map(cardHtml).join('') +
        (missing.length
            ? `<div class="cmd-agents-missing"><span>Not detected</span>${missing
                  .map((s) => `<i>${agentLogo(s.id, 13)}${escapeHtml(s.name)}</i>`)
                  .join('')}</div>`
            : '');
}

function cardHtml(s) {
    const meta = [s.version, s.cli_path ?? (s.config_dir ? `config: ${s.config_dir}` : null)]
        .filter(Boolean)
        .map(escapeHtml)
        .join(' · ');
    const meters = s.meters.map(meterHtml).join('');
    const hasUsage = s.windows.some((w) => w.requests > 0);
    const windows = s.windows.length
        ? `<div class="cmd-agents-windows">${s.windows.map(windowHtml).join('')}</div>`
        : '';
    return `<div class="cmd-agents-card">
        <div class="cmd-agents-head">
            <span class="cmd-agents-name">${agentLogo(s.id, 20)}${escapeHtml(s.name)}</span>
            <span class="cmd-agents-meta" title="${escapeHtml(s.cli_path ?? '')}">${meta}</span>
        </div>
        ${meters}
        ${hasUsage || s.windows.length ? windows : ''}
        ${s.note ? `<div class="cmd-agents-note">${escapeHtml(s.note)}</div>` : ''}
    </div>`;
}

function levelOf(percent) {
    return percent >= DANGER_PERCENT ? 'danger' : percent >= WARN_PERCENT ? 'warn' : 'ok';
}

function meterHtml(m) {
    const pct = Math.round(m.used_percent);
    const reset = m.resets_at_unix_s ? formatReset(m.resets_at_unix_s) : '';
    const tag = m.stale ? 'last session, since reset' : m.source === 'live' ? 'live' : 'from log';
    return `<div class="cmd-agents-meter${m.stale ? ' stale' : ''}">
        <div class="cmd-agents-meter-top">
            <span>${escapeHtml(m.label)}</span>
            <span class="cmd-agents-pct cmd-agents-${levelOf(pct)}">${pct}%</span>
        </div>
        <div class="cmd-agents-bar"><div class="cmd-agents-fill cmd-agents-${levelOf(pct)}" style="width:${Math.max(2, pct)}%"></div></div>
        <div class="cmd-agents-meter-sub"><span>${tag}</span><span>${reset}</span></div>
    </div>`;
}

function windowHtml(w) {
    const io = w.input + w.output;
    const cache = w.cache_read + w.cache_write;
    return `<div class="cmd-agents-window">
        <span class="cmd-agents-window-label">${escapeHtml(w.label)}</span>
        <span title="Input + output tokens">${formatTokens(io)} tokens</span>
        <span class="cmd-agents-dim" title="Cached tokens read or written">${formatTokens(cache)} cached</span>
        <span class="cmd-agents-dim">${w.requests} req</span>
    </div>`;
}

function formatTokens(n) {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
    return String(n);
}

function formatReset(unixS) {
    const secs = unixS - Math.floor(Date.now() / 1000);
    if (secs <= 0) return 'reset';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (d > 0) return `resets in ${d}d ${h}h`;
    if (h > 0) return `resets in ${h}h ${m}m`;
    return `resets in ${m}m`;
}
