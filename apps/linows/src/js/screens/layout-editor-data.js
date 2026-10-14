// What the Customize Super Actions editor draws with: which glyph each tile
// wears, which glyphs a custom tile may name, and the refresh intervals it offers.

import {
    bluetooth,
    wifi,
    moon,
    battery,
    coffee,
    monitor,
    mic,
    refreshCw,
    power,
    cloudSun,
    music,
    bot,
    timer,
    gauge,
    notebook,
    clock,
    info as infoIcon,
    listChecks,
} from '../icons.js';

// Glyphs a tile may name in `icon`; anything else is read as an image path.
export const GLYPHS = {
    bluetooth,
    wifi,
    theme: moon,
    keepawake: coffee,
    battery,
    screensaver: monitor,
    mic,
    restart: refreshCw,
    shutdown: power,
};

// Built-in tile -> glyph on the canvas.
export const TILE_ICON = {
    lslot: listChecks,
    bluetooth,
    wifi,
    battery,
    theme: moon,
    keepawake: coffee,
    screensaver: monitor,
    weather: cloudSun,
    mic,
    restart: refreshCw,
    shutdown: power,
    nowplaying: music,
    agents: bot,
    todo: listChecks,
    pomo: timer,
    speed: gauge,
    notes: notebook,
    clock,
    system: infoIcon,
};

export const REFRESH_CHOICES = [
    ['', 'Default (1 min)'],
    ['15s', 'Every 15 seconds'],
    ['30s', 'Every 30 seconds'],
    ['1m', 'Every minute'],
    ['5m', 'Every 5 minutes'],
    ['15m', 'Every 15 minutes'],
    ['30m', 'Every 30 minutes'],
    ['1h', 'Every hour'],
    ['6h', 'Every 6 hours'],
];
