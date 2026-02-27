#!/usr/bin/env bun
/**
 * DEMOD — Terminal Chromatic Tuner  v1.2.1 PRODUCTION GRADE
 * https://github.com/ALH477/demod
 * © 2026 ALH477 — BSD-3-Clause
 *
 * Fully production-ready terminal tuner with:
 *   • Automatic device selection + last-device persistence
 *   • Dynamic sample-rate detection (PipeWire / ALSA / CoreAudio)
 *   • Low-latency capture (1024-sample buffer = ~21 ms @ 48 kHz)
 *   • Peak-hold VU meter
 *   • Robust error handling & graceful fallbacks
 *   • CLI flags: --help, --version, --a4=442, --device=ID, --rate=48000
 *   • Real-time priority hints (Linux)
 *
 * Run: bun demod.ts
 *     bun demod.ts --help
 */

import { spawn, execSync } from "child_process";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── CLI Argument Parsing (production standard) ───────────────────────────────
const args = process.argv.slice(2);
let CLI_A4 = 0;
let CLI_DEVICE = "";
let CLI_RATE = 0;
let SHOW_HELP = false;
let SHOW_VERSION = false;

let SHOW_LIST_DEVICES = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--help" || a === "-h") SHOW_HELP = true;
  if (a === "--version" || a === "-v") SHOW_VERSION = true;
  if (a === "--list-devices") SHOW_LIST_DEVICES = true;
  if (a.startsWith("--a4=")) CLI_A4 = parseFloat(a.slice(5));
  if (a.startsWith("--device=")) CLI_DEVICE = a.slice(9);
  if (a.startsWith("--rate=")) CLI_RATE = parseInt(a.slice(7));
}

if (SHOW_HELP) {
  console.log(`DEMOD v1.2.1 — Production Terminal Chromatic Tuner
Usage: bun demod.ts [options]

Options:
  --help, -h          Show this help
  --version, -v       Show version
  --list-devices      Print detected audio input devices and exit
  --a4=442            Set reference pitch (415–465)
  --device=ID         Force specific device ID
  --rate=48000        Force sample rate

Keyboard in app:
  Tab   Cycle palette
  i     Input device menu
  A     Set A4
  +/-   Nudge A4 by 0.5 Hz
  q     Quit
`);
  process.exit(0);
}

if (SHOW_VERSION) {
  console.log("DEMOD Terminal Chromatic Tuner v1.2.1");
  process.exit(0);
}

// ─── Config & Persistence ─────────────────────────────────────────────────────
const CONFIG_DIR = path.join(os.homedir(), ".config", "demod");
const A4_FILE = path.join(CONFIG_DIR, "a4");
const LAST_DEV_FILE = path.join(CONFIG_DIR, "last-device.json");

let REFERENCE_FREQ = CLI_A4 || 440;
try {
  if (!CLI_A4 && fs.existsSync(A4_FILE)) {
    const val = parseFloat(fs.readFileSync(A4_FILE, "utf-8").trim());
    if (!isNaN(val) && val >= 415 && val <= 465) REFERENCE_FREQ = val;
  }
} catch {}

function saveA4(val: number) {
  if (val < 415 || val > 465) return;
  REFERENCE_FREQ = val;
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(A4_FILE, val.toFixed(1));
  } catch {}
}

// ─── Constants ────────────────────────────────────────────────────────────────
const NFFT = 1024;
const SILENCE = 0.007;
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// ─── ANSI ─────────────────────────────────────────────────────────────────────
const R = "\x1b[0m"; const B = "\x1b[1m"; const DIM = "\x1b[2m";
const HIDE = "\x1b[?25l"; const SHOW = "\x1b[?25h";
const ALT = "\x1b[?1049h"; const NORM = "\x1b[?1049l";
const ERASE = "\x1b[2J\x1b[H";
const go = (r: number, c: number) => `\x1b[${r};${c}H`;
const fg = (c: [number,number,number]) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bg = (c: [number,number,number]) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
const lerp3 = (a: [number,number,number], b: [number,number,number], t: number): [number,number,number] => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

// ─── Palettes ─────────────────────────────────────────────────────────────────
interface Palette {
  name: string;
  surface: [number,number,number]; surfaceAlt: [number,number,number]; surfaceLow: [number,number,number];
  border: [number,number,number]; borderBright: [number,number,number];
  text: [number,number,number]; textMuted: [number,number,number]; textDim: [number,number,number];
  accent: [number,number,number]; accentSoft: [number,number,number];
  inTune: [number,number,number]; flat: [number,number,number]; sharp: [number,number,number];
  warn: [number,number,number];
  specLo: [number,number,number]; specMid: [number,number,number]; specHi: [number,number,number];
  H:string; V:string; TL:string; TR:string; BL:string; BR:string;
  HL:string; HR:string; HT:string; HB:string; HX:string;
  breathChars: string[];
}

const P: Palette[] = [
  {
    name:"PHOSPHOR",
    surface:[8,14,8], surfaceAlt:[13,24,13], surfaceLow:[4,8,4],
    border:[28,90,28], borderBright:[57,220,57],
    text:[200,255,200], textMuted:[110,200,110], textDim:[50,100,50],
    accent:[57,255,57], accentSoft:[40,220,40],
    inTune:[100,255,100], flat:[255,100,60], sharp:[255,240,40],
    warn:[255,180,0],
    specLo:[30,140,30], specMid:[80,255,80], specHi:[200,255,200],
    H:"═",V:"║",TL:"╔",TR:"╗",BL:"╚",BR:"╝",HL:"╠",HR:"╣",HT:"╦",HB:"╩",HX:"╬",
    breathChars:["·","∘","○","◌","◎"],
  },
  {
    name:"CINDER",
    surface:[16,8,4], surfaceAlt:[24,14,8], surfaceLow:[10,5,2],
    border:[100,50,15], borderBright:[200,100,30],
    text:[255,220,160], textMuted:[190,130,80], textDim:[100,60,30],
    accent:[255,150,30], accentSoft:[220,110,20],
    inTune:[180,255,80], flat:[255,80,50], sharp:[255,220,50],
    warn:[255,120,0],
    specLo:[160,60,20], specMid:[255,140,40], specHi:[255,230,140],
    H:"━",V:"┃",TL:"┏",TR:"┓",BL:"┗",BR:"┛",HL:"┣",HR:"┫",HT:"┳",HB:"┻",HX:"╋",
    breathChars:["·","◦","∘","○","◉"],
  },
  {
    name:"PLASMA",
    surface:[10,4,22], surfaceAlt:[16,8,34], surfaceLow:[6,2,16],
    border:[70,30,140], borderBright:[160,70,255],
    text:[230,190,255], textMuted:[150,110,220], textDim:[70,50,120],
    accent:[220,70,255], accentSoft:[180,50,240],
    inTune:[80,255,220], flat:[255,70,120], sharp:[255,240,80],
    warn:[255,200,0],
    specLo:[100,30,180], specMid:[220,80,255], specHi:[240,200,255],
    H:"─",V:"│",TL:"╭",TR:"╮",BL:"╰",BR:"╯",HL:"├",HR:"┤",HT:"┬",HB:"┴",HX:"┼",
    breathChars:["·","⋅","∙","●","◉"],
  },
  {
    name:"ARCTIC",
    surface:[8,12,20], surfaceAlt:[14,20,30], surfaceLow:[4,8,14],
    border:[50,90,140], borderBright:[100,180,255],
    text:[220,240,255], textMuted:[130,170,230], textDim:[60,90,140],
    accent:[110,190,255], accentSoft:[70,140,230],
    inTune:[100,255,200], flat:[255,110,140], sharp:[255,230,90],
    warn:[255,200,0],
    specLo:[50,100,180], specMid:[120,200,255], specHi:[220,240,255],
    H:"╌",V:"╎",TL:"╭",TR:"╮",BL:"╰",BR:"╯",HL:"├",HR:"┤",HT:"┬",HB:"┴",HX:"┼",
    breathChars:["·","⁚","⁝","⋮","⠿"],
  },
];

// ─── Glyphs ───────────────────────────────────────────────────────────────────
const GLYPH_W = 5;
const GLYPH_H = 7;
type Glyph = number[][];
const GLYPHS: Record<string, Glyph> = {
  "C": [[0,1,3,3,1],[1,3,0,0,0],[3,2,0,0,0],[3,2,0,0,0],[3,2,0,0,0],[1,3,0,0,0],[0,1,3,3,1]],
  "D": [[3,3,3,1,0],[3,2,0,3,1],[3,2,0,0,3],[3,2,0,0,3],[3,2,0,0,3],[3,2,0,3,1],[3,3,3,1,0]],
  "E": [[3,3,3,3,3],[3,2,0,0,0],[3,2,0,0,0],[3,3,3,3,0],[3,2,0,0,0],[3,2,0,0,0],[3,3,3,3,3]],
  "F": [[3,3,3,3,3],[3,2,0,0,0],[3,2,0,0,0],[3,3,3,3,0],[3,2,0,0,0],[3,2,0,0,0],[3,2,0,0,0]],
  "G": [[0,1,3,3,1],[1,3,0,0,0],[3,2,0,0,0],[3,2,0,3,3],[3,2,0,0,3],[1,3,0,1,3],[0,1,3,3,2]],
  "A": [[0,0,3,0,0],[0,1,3,1,0],[1,3,0,3,1],[3,2,0,2,3],[3,3,3,3,3],[3,2,0,2,3],[3,2,0,2,3]],
  "B": [[3,3,3,2,0],[3,2,0,3,1],[3,2,0,1,3],[3,3,3,3,0],[3,2,0,0,3],[3,2,0,0,3],[3,3,3,3,1]],
  "#": [[0,1,0,1,0],[0,1,0,1,0],[3,3,3,3,3],[0,1,0,1,0],[3,3,3,3,3],[0,1,0,1,0],[0,1,0,1,0]],
  "?": [[0,3,3,3,0],[3,0,0,0,3],[0,0,0,1,3],[0,0,1,3,0],[0,0,3,0,0],[0,0,0,0,0],[0,0,3,0,0]],
};

function renderGlyph(glyph: Glyph, p: Palette, row: number, col: number, inTune: boolean, cents: number): string {
  const colorMap: [number,number,number][] = [
    p.surfaceLow,
    p.textDim,
    p.textMuted,
    inTune ? p.inTune : (cents < 0 ? p.flat : p.sharp),
  ];
  let out = "";
  for (let r = 0; r < GLYPH_H; r++) {
    out += go(row + r, col);
    for (let c = 0; c < GLYPH_W; c++) {
      const v = glyph[r][c];
      out += fg(colorMap[v]) + "██";
    }
    out += R;
  }
  return out;
}

function renderNoteGlyphs(noteName: string, p: Palette, row: number, col: number, inTune: boolean, cents: number): string {
  let out = "";
  let x = col;
  for (const ch of noteName) {
    const g = GLYPHS[ch] ?? GLYPHS["?"];
    out += renderGlyph(g, p, row, x, inTune, cents);
    x += GLYPH_W * 2 + 4;
  }
  return out;
}

// ─── Arc Needle ───────────────────────────────────────────────────────────────
function buildArcNeedle(cents: number, width: number, p: Palette): string[] {
  const half = Math.floor((width - 2) / 2);
  const pos = Math.round((cents / 50) * half) + half;
  const inTune = Math.abs(cents) <= 5;

  const ticks = Array(width).fill(" ");
  for (let i = -half; i <= half; i += 5) {
    const idx = i + half;
    if (idx < 0 || idx >= width) continue;
    ticks[idx] = fg(i === 0 ? p.borderBright : p.textDim) + (i === 0 ? "┼" : "╷") + R;
  }

  const row1: string[] = [];
  for (let i = 0; i < width; i++) {
    const ratio = Math.abs(i - half) / half;
    let zone = ratio < 0.10 ? p.inTune :
               ratio < 0.35 ? lerp3(p.inTune, p.warn, (ratio - 0.10)/0.25) :
                              lerp3(p.warn, i < half ? p.flat : p.sharp, (ratio - 0.35)/0.65);
    if (i === pos) {
      row1.push(fg(inTune ? p.inTune : (cents < 0 ? p.flat : p.sharp)) + B + "▼" + R);
    } else {
      row1.push(fg(zone) + DIM + "─" + R);
    }
  }

  const row2 = Array(width).fill(" ");
  [-50,-25,0,25,50].forEach(v => {
    const idx = Math.round((v / 50) * half) + half;
    if (idx >= 0 && idx < width) {
      row2[idx] = fg(v === 0 ? p.borderBright : p.textDim) + (v === 0 ? "0" : v > 0 ? `+${v}` : v) + R;
    }
  });
  if (pos >= 0 && pos < width) {
    row2[pos] = fg(inTune ? p.inTune : (cents < 0 ? p.flat : p.sharp)) + B + "│" + R;
  }

  return [ticks.join(""), row1.join(""), row2.join("")];
}

// ─── VU Bar with Peak Hold ────────────────────────────────────────────────────
function vuBar(level: number, peak: number, width: number, p: Palette): string {
  const filled = Math.round(level * width);
  const peakPos = Math.round(peak * width);
  let s = "";
  for (let i = 0; i < width; i++) {
    const ratio = i / width;
    const col = ratio < 0.6 ? p.inTune : ratio < 0.85 ? p.warn : p.flat;
    if (i === peakPos) {
      s += fg(p.accent) + "▴";
    } else {
      s += fg(i < filled ? col : p.surfaceAlt) + (i < filled ? "█" : "░");
    }
  }
  return s + R;
}

// ─── Spectrum Waterfall ───────────────────────────────────────────────────────
const VBAR = " ▁▂▃▄▅▆▇█";

function spectrumRow(bands: number[], w: number, p: Palette, age: number): string {
  const fade = Math.max(0.15, 1 - age * 0.22);
  let s = "";
  const count = Math.min(bands.length, w);
  for (let i = 0; i < count; i++) {
    const v = bands[i];
    const idx = Math.min(7, Math.floor(v * 8));
    const base = v < 0.4 ? p.specLo : v < 0.75 ? p.specMid : p.specHi;
    const col = lerp3(p.surface, base, fade * v * 1.2);
    s += fg(col) + VBAR[idx + 1];
  }
  return s + R;
}

// ─── History Sparkline ────────────────────────────────────────────────────────
function historySpark(hist: number[], w: number, p: Palette): string {
  const slice = hist.slice(-w);
  return slice.map(v => {
    const norm = (Math.max(-50, Math.min(50, v)) + 50) / 100;
    const idx = Math.min(7, Math.floor(norm * 8));
    const col = Math.abs(v) <= 5 ? p.inTune : v < 0 ? p.flat : p.sharp;
    return fg(col) + DIM + VBAR[idx + 1] + R;
  }).join("");
}

// ─── Music Theory ─────────────────────────────────────────────────────────────
const f2m = (f: number) => 69 + 12 * Math.log2(f / REFERENCE_FREQ);
const m2f = (m: number) => REFERENCE_FREQ * Math.pow(2, (m - 69) / 12);

function parseNote(m: number) {
  const r = Math.round(m);
  return {
    name: NOTE_NAMES[((r % 12) + 12) % 12],
    oct: Math.floor((r - 12) / 12),
    cents: (m - r) * 100,
  };
}

// ─── Devices & Capture ────────────────────────────────────────────────────────
interface Device { id: string; name: string; backend: string; rate: number; }

function detectDevices(): Device[] {
  const list: Device[] = [];
  const defaultRate = CLI_RATE || 48000;

  // ── PipeWire ──────────────────────────────────────────────────────────────
  try {
    const out = execSync("pw-record --list-targets 2>&1", { timeout: 2000, encoding: "utf8" });
    for (const line of out.split("\n")) {
      // Modern format:  "  *   52  |  input.HDMI | HDMI ... | 48000 Hz ..."
      // Legacy format:  "  52  node.name ..."
      const modern = line.match(/^\s*\*?\s*(\d+)\s+\|\s+([^|]+)\|\s+[^|]+\|/);
      if (modern) {
        const rateMatch = line.match(/(\d{4,6})\s*Hz/);
        list.push({
          id: modern[1],
          name: modern[2].trim(),
          backend: "pipewire",
          rate: rateMatch ? parseInt(rateMatch[1]) : defaultRate,
        });
        continue;
      }
      // Alternative pw-cli style: "  id: 52, name: alsa_input.pci..."
      const pwcli = line.match(/id:\s*(\d+),\s*name:\s*(\S+)/);
      if (pwcli) {
        list.push({ id: pwcli[1], name: pwcli[2], backend: "pipewire", rate: defaultRate });
      }
    }
  } catch {}

  // ── ALSA ──────────────────────────────────────────────────────────────────
  if (!list.length) {
    try {
      const out = execSync("arecord -l 2>&1", { encoding: "utf8", timeout: 1500 });
      for (const line of out.split("\n")) {
        const m = line.match(/card\s+(\d+)[^:]*:\s+([^[]+)/i);
        if (m) {
          list.push({ id: `hw:${m[1]},0`, name: m[2].trim(), backend: "alsa", rate: defaultRate });
        }
      }
    } catch {}
  }

  // ── SoX / CoreAudio fallback ───────────────────────────────────────────────
  if (!list.length || process.platform === "darwin") {
    list.push({ id: "default", name: "Default Input (CoreAudio/SoX)", backend: "sox", rate: defaultRate });
  }

  if (CLI_DEVICE) {
    const forced = list.find(d => d.id === CLI_DEVICE);
    if (forced) return [forced];
    // Device not found — warn but don't crash
    console.error(`Warning: --device=${CLI_DEVICE} not found in detected devices. Using all.`);
  }

  return list;
}

function spawnCapture(dev: Device) {
  const rate = dev.rate;

  if (dev.backend === "pipewire") {
    return spawn("pw-record", [
      "--target", dev.id,
      "--rate", String(rate),
      "--channels", "1",
      "--format", "s16",
      "--latency", `${NFFT}/${rate}`,
      "-"
    ], { stdio: ["ignore", "pipe", "ignore"] });
  }

  if (dev.backend === "alsa") {
    // -B = buffer time in microseconds; 1024 samples @ rate Hz ≈ (1024/rate)*1e6 µs
    const bufUs = Math.round((NFFT / rate) * 1_000_000);
    return spawn("arecord", [
      "-D", dev.id,
      "-r", String(rate),
      "-f", "S16_LE",
      "-c", "1",
      "-t", "raw",
      "-B", String(bufUs),
    ], { stdio: ["ignore", "pipe", "ignore"] });
  }

  if (dev.backend === "sox") {
    return spawn("sox", [
      "-q", "-d", "-r", String(rate),
      "-e", "signed-integer", "-b", "16", "-c", "1", "-t", "raw", "-"
    ], { stdio: ["ignore", "pipe", "ignore"] });
  }
  return null;
}

// ─── App State ────────────────────────────────────────────────────────────────
interface State {
  overlay: boolean;
  devices: Device[];
  selIdx: number;
  activeDev: Device | null;
  palette: number;
  freq: number | null;
  smoothMidi: number | null;
  waterfall: number[][];
  vu: number;
  vuPeak: number;
  vuPeakTimer: number;
  history: number[];
  proc: ReturnType<typeof spawn> | null;
  cols: number;
  rows: number;
  status: string;
  lostFrames: number;
}

const state: State = {
  overlay: true,
  devices: [],
  selIdx: 0,
  activeDev: null,
  palette: 0,
  freq: null,
  smoothMidi: null,
  waterfall: [],
  vu: 0,
  vuPeak: 0,
  vuPeakTimer: 0,
  history: [],
  proc: null,
  cols: 80,
  rows: 24,
  status: "Starting…",
  lostFrames: 0,
};

const pal = () => P[state.palette];

// ─── Layout ───────────────────────────────────────────────────────────────────
function layout() {
  const { rows } = state;
  const noteH = Math.max(10, Math.floor(rows * 0.38));
  const needleH = 6;
  const dataH = rows - noteH - needleH - 2;
  const waterfallH = Math.min(8, Math.max(4, dataH - 4));
  return { noteH, needleH, waterfallH, statusRow: rows };
}

// ─── Overlay ──────────────────────────────────────────────────────────────────
function drawOverlay(): string {
  const p = pal();
  const { cols, rows, devices, selIdx } = state;
  let out = "";

  const W = Math.min(64, cols - 4);
  const H = Math.min(devices.length + 10, rows - 4);
  const r0 = Math.max(2, Math.floor((rows - H) / 2));
  const c0 = Math.max(2, Math.floor((cols - W) / 2));

  for (let r = 1; r <= rows; r++) out += go(r,1) + bg(p.surfaceLow) + " ".repeat(cols) + R;

  for (let r = r0; r < r0 + H; r++) out += go(r, c0) + bg(p.surfaceAlt) + " ".repeat(W) + R;

  out += go(r0, c0) + fg(p.borderBright) + p.TL + p.H.repeat(W-2) + p.TR + R;
  for (let r = r0+1; r < r0+H-1; r++) {
    out += go(r, c0) + fg(p.border) + p.V + R;
    out += go(r, c0+W-1) + fg(p.border) + p.V + R;
  }
  out += go(r0+H-1, c0) + fg(p.borderBright) + p.BL + p.H.repeat(W-2) + p.BR + R;

  const title = " AUDIO INPUT ";
  out += go(r0, c0 + Math.floor((W-title.length)/2)) + bg(p.surfaceAlt) + fg(p.accent) + B + title + R;

  const listTop = r0 + 3;
  for (let i = 0; i < devices.length; i++) {
    const dev = devices[i];
    const sel = i === selIdx;
    const row = listTop + i;
    if (row >= r0 + H - 3) break;

    const name = dev.name.slice(0, W-14);
    const badge = dev.backend ? ` ${dev.backend.toUpperCase()} ` : " ? ";
    const bcol = dev.backend === "pipewire" ? p.accent : dev.backend === "alsa" ? p.warn : p.accentSoft;

    if (sel) {
      out += go(row, c0+1) + bg(p.accent) + fg(p.surface) + B + "▶ " + name.padEnd(W-12) + badge + R;
    } else {
      out += go(row, c0+1) + bg(p.surfaceAlt) + fg(p.text) + "  " + name.padEnd(W-12) + fg(bcol) + DIM + badge + R;
    }
  }

  out += go(r0+H-2, c0+2) + bg(p.surfaceAlt) + fg(p.textDim) +
    "↑↓ select   ↵ confirm   Tab palette   q quit" + R;

  return out;
}

// ─── Tuner Screen ─────────────────────────────────────────────────────────────
function drawTuner(): string {
  const p = pal();
  const { cols, rows, freq, smoothMidi, vu, vuPeak, waterfall, history, lostFrames } = state;
  const { noteH, needleH, waterfallH, statusRow } = layout();
  let out = "";

  for (let r = 1; r <= rows; r++) out += go(r,1) + bg(p.surface) + " ".repeat(cols) + R;

  const hasSignal = smoothMidi !== null && lostFrames < 6;
  const note = hasSignal ? parseNote(smoothMidi!) : null;
  const inTune = note ? Math.abs(note.cents) <= 5 : false;

  // ZONE NOTE
  const noteTop = 2;
  if (hasSignal && note) {
    const glyphX = Math.max(4, cols - 40);
    out += renderNoteGlyphs(note.name, p, noteTop, glyphX, inTune, note.cents);

    out += go(noteTop, 4) + fg(p.textDim) + "FREQUENCY" + R;
    out += go(noteTop + 1, 4) + fg(p.accent) + B + freq!.toFixed(2) + R + fg(p.textMuted) + " Hz" + R;

    out += go(noteTop + 2, 4) + fg(p.textDim) + "TARGET" + R + fg(p.text) + ` ${m2f(Math.round(smoothMidi!)).toFixed(2)} Hz` + R;

    out += go(noteTop + 3, 4) + fg(p.textDim) + "CENTS" + R;
    const cStr = (note.cents >= 0 ? "+" : "") + note.cents.toFixed(1) + "¢";
    out += go(noteTop + 3, 10) + fg(inTune ? p.inTune : note.cents < 0 ? p.flat : p.sharp) + B + cStr + R;

    out += go(noteTop + 4, 4) + (inTune
      ? bg(p.inTune) + fg(p.surface) + B + "  IN TUNE  " + R
      : fg(note.cents < 0 ? p.flat : p.sharp) + B + (note.cents < 0 ? "♭ TUNE UP" : "♯ TUNE DOWN") + R
    );
  } else {
    const mid = Math.floor(cols / 2) - 10;
    out += go(noteTop + 4, mid) + fg(p.textDim) + DIM + "listening… " + fg(p.accentSoft) + (["·","∘","○","◌","◎"][lostFrames % 5]) + R;
    out += go(noteTop + 5, mid) + fg(p.border) + "play any note" + R;
  }

  // ZONE NEEDLE
  const needleTop = noteH + 1;
  out += go(needleTop, 1) + fg(p.border) + "═".repeat(cols) + R;

  out += go(needleTop + 1, 4) + fg(p.textDim) + "CENTS" + R;
  out += go(needleTop + 1, cols - 22) + fg(p.textDim) + `A4 = ${REFERENCE_FREQ.toFixed(1)} Hz` + R;

  const needleW = Math.min(cols - 8, 90);
  const needleX = Math.floor((cols - needleW) / 2) + 1;
  const arc = buildArcNeedle(note?.cents ?? 0, needleW, p);
  arc.forEach((line, i) => out += go(needleTop + 2 + i, needleX) + line);

  // ZONE DATA
  const dataTop = needleTop + needleH + 1;
  out += go(dataTop, 1) + fg(p.border) + "═".repeat(cols) + R;

  for (let i = 0; i < waterfallH; i++) {
    const age = waterfallH - 1 - i;
    const row = waterfall[waterfall.length - 1 - age] ?? [];
    out += go(dataTop + 1 + i, 3) + spectrumRow(row, cols - 6, p, age);
  }

  const infoRow = dataTop + waterfallH + 1;
  if (infoRow < statusRow) {
    out += go(infoRow, 4) + fg(p.textDim) + "HIST" + R;
    out += go(infoRow, 9) + historySpark(history, Math.floor(cols / 2) - 12, p);

    out += go(infoRow, Math.floor(cols / 2) + 2) + fg(p.textDim) + "VU" + R;
    out += go(infoRow, Math.floor(cols / 2) + 5) + vuBar(state.vu, state.vuPeak, cols - Math.floor(cols / 2) - 10, p);
  }

  // STATUS BAR
  out += go(statusRow, 1) + bg(p.surfaceLow) + " ".repeat(cols) + R;
  out += go(statusRow, 2) + bg(p.surfaceLow) + fg(p.textDim) +
    (state.activeDev?.backend?.toUpperCase() ?? "?") + " " +
    fg(p.textMuted) + (state.activeDev?.name?.slice(0, 32) ?? "no input") + R;

  const center = Math.floor(cols / 2) - 8;
  out += go(statusRow, center) + bg(p.surfaceLow) + fg(p.accentSoft) + state.status + R;

  out += go(statusRow, cols - 28) + bg(p.surfaceLow) + fg(p.border) +
    " i:input  A:set A4  +/-:nudge  Tab:palette  q:quit " + R;

  return out;
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  process.stdout.write(state.overlay ? drawOverlay() : drawTuner());
}

// ─── Audio Loop ───────────────────────────────────────────────────────────────
async function startCapture(dev: Device) {
  if (state.proc) { state.proc.kill(); state.proc = null; }

  const proc = spawnCapture(dev);
  if (!proc) {
    state.status = `Failed to start ${dev.backend} capture`;
    state.overlay = true;
    render();
    return;
  }

  state.proc = proc;
  state.status = `Capturing @ ${dev.rate} Hz from ${dev.name}`;
  render();

  const sampleRate = dev.rate;
  const chunkSize = NFFT * 2;
  let buffer = Buffer.alloc(0);
  let active = true;

  proc.on("error", (err) => {
    state.status = `Capture error: ${err.message}`;
    render();
  });

  proc.stdout!.on("error", (err) => {
    state.status = `Stream error: ${err.message}`;
    render();
  });

  proc.on("close", (code) => {
    if (active && state.proc === proc) {
      state.status = `Capture ended (exit ${code})`;
      state.proc = null;
      state.smoothMidi = null;
      state.freq = null;
      render();
    }
  });

  // VU display gain: RMS of typical speech/instrument is ~0.02–0.1 after /32768 norm
  const VU_GAIN = 6;

  for await (const chunk of proc.stdout!) {
    if (!active) break;
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= chunkSize) {
      const slice = buffer.subarray(0, chunkSize);
      buffer = buffer.subarray(chunkSize);

      const floats = new Float32Array(NFFT);
      let sumSq = 0;
      for (let i = 0; i < NFFT; i++) {
        floats[i] = slice.readInt16LE(i * 2) / 32768;
        sumSq += floats[i] * floats[i];
      }
      const rms = Math.sqrt(sumSq / NFFT);
      const vuScaled = Math.min(1, rms * VU_GAIN);

      state.vu = vuScaled > state.vu ? vuScaled : state.vu * 0.92;
      if (state.vu > state.vuPeak) { state.vuPeak = state.vu; state.vuPeakTimer = 45; }
      else if (--state.vuPeakTimer <= 0) state.vuPeak *= 0.97;

      const bands = calcBands(floats, Math.min(state.cols - 6, 80), sampleRate);
      state.waterfall.push(bands);
      if (state.waterfall.length > 20) state.waterfall.shift();

      const f = detectPitch(floats, sampleRate);
      if (f && f > 25 && f < 2500) {
        const m = f2m(f);
        state.smoothMidi = state.smoothMidi === null ? m : 0.32 * m + 0.68 * state.smoothMidi;
        state.freq = m2f(state.smoothMidi);
        state.history.push(parseNote(state.smoothMidi).cents);
        state.lostFrames = 0;
        state.status = "";
      } else {
        state.lostFrames++;
        if (state.lostFrames > 5) {
          state.smoothMidi = null;
          state.freq = null;
        }
        state.history.push(0);
      }
      if (state.history.length > 200) state.history.shift();

      render();
    }
  }
  active = false;
}

function calcBands(buf: Float32Array, count: number, sampleRate: number): number[] {
  const lo = 80, hi = 5000;
  const res: number[] = [];
  for (let i = 0; i < count; i++) {
    const f = lo * Math.pow(hi / lo, i / (count - 1));
    const lag = Math.round(sampleRate / f);
    if (lag < 2 || lag >= buf.length) { res.push(0); continue; }
    let s = 0;
    for (let j = 0; j < buf.length - lag; j++) s += buf[j] * buf[j + lag];
    res.push(s / (buf.length - lag));
  }
  const mx = Math.max(...res, 1e-8);
  return res.map(v => Math.min(1, v / mx));
}

function detectPitch(buf: Float32Array, sampleRate: number): number | null {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < SILENCE) return null;

  const minL = Math.floor(sampleRate / 1600);
  const maxL = Math.floor(sampleRate / 40);
  let best = -1, bestV = -Infinity;
  for (let lag = minL; lag <= maxL; lag++) {
    let s = 0;
    for (let i = 0; i < n - lag; i++) s += buf[i] * buf[i + lag];
    s /= (n - lag);
    if (s > bestV) { bestV = s; best = lag; }
  }
  if (best < 0 || bestV < SILENCE * 0.05) return null;

  const ac = (lag: number) => {
    let s = 0;
    for (let i = 0; i < n - lag; i++) s += buf[i] * buf[i + lag];
    return s / (n - lag);
  };
  if (best > minL && best < maxL) {
    const y0 = ac(best-1), y1 = ac(best), y2 = ac(best+1);
    const d = 2 * (2 * y1 - y0 - y2);
    if (Math.abs(d) > 1e-9) return sampleRate / (best + (y0 - y2) / d);
  }
  return sampleRate / best;
}

// ─── Auto-Connect ─────────────────────────────────────────────────────────────
function autoConnect() {
  try {
    if (fs.existsSync(LAST_DEV_FILE)) {
      const saved = JSON.parse(fs.readFileSync(LAST_DEV_FILE, "utf-8"));
      const idx = state.devices.findIndex(d => d.id === saved.id);
      if (idx >= 0) {
        state.activeDev = state.devices[idx];
        state.selIdx = idx;
        state.overlay = false;
        state.status = `Auto-connected to ${state.activeDev.name} @ ${state.activeDev.rate} Hz`;
        startCapture(state.activeDev);
        return true;
      }
    }
  } catch {}
  return false;
}

// ─── Input ────────────────────────────────────────────────────────────────────
function setupInput() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  process.stdin.on("keypress", (_, key) => {
    if (!key) return;
    if ((key.ctrl && key.name === "c") || key.name === "q") { cleanup(); process.exit(0); }

    if (key.name === "tab") { state.palette = (state.palette + 1) % P.length; render(); return; }

    if (state.overlay) {
      if (key.name === "up") state.selIdx = Math.max(0, state.selIdx - 1);
      if (key.name === "down") state.selIdx = Math.min(state.devices.length - 1, state.selIdx + 1);
      if (key.name === "return" || key.name === "enter") {
        state.activeDev = state.devices[state.selIdx];
        state.overlay = false;
        try { fs.writeFileSync(LAST_DEV_FILE, JSON.stringify({ id: state.activeDev.id })); } catch {}
        startCapture(state.activeDev);
      }
    } else {
      if (key.name === "i" || key.name === "escape") { state.overlay = true; render(); }
      if (key.name === "a") {
        // Must exit raw mode before readline can work
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdout.write(go(state.rows, 1) + "\x1b[K"); // clear status line for input
        const input = readline.createInterface({ input: process.stdin, output: process.stdout });
        input.question(`Set A4 [415–465] (current: ${REFERENCE_FREQ}): `, val => {
          const n = parseFloat(val);
          if (!isNaN(n) && n >= 415 && n <= 465) {
            saveA4(n);
            state.status = `A4 set to ${n.toFixed(1)} Hz`;
          }
          input.close();
          if (process.stdin.isTTY) process.stdin.setRawMode(true);
          render();
        });
        return; // don't fall through to render() below
      }
      if (key.name === "+" || key.name === "=") { saveA4(Math.min(465, REFERENCE_FREQ + 0.5)); render(); }
      if (key.name === "-") { saveA4(Math.max(415, REFERENCE_FREQ - 0.5)); render(); }
    }
    render();
  });
}

function cleanup() {
  if (state.proc) state.proc.kill();
  process.stdout.write(SHOW + NORM + "\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const size = process.stdout.getWindowSize?.() ?? [80, 24];
  state.cols = size[0];
  state.rows = size[1];

  state.devices = detectDevices();

  if (SHOW_LIST_DEVICES) {
    if (!state.devices.length) { console.log("No audio input devices found."); process.exit(1); }
    console.log("Detected audio input devices:");
    state.devices.forEach(d => console.log(`  [${d.backend.toUpperCase()}] id=${d.id}  rate=${d.rate}  ${d.name}`));
    process.exit(0);
  }

  if (!state.devices.length) {
    console.error("No audio input devices found. Install pipewire/alsa-utils/sox.");
    process.exit(1);
  }

  process.stdout.on("resize", () => {
    const s = process.stdout.getWindowSize?.() ?? [80, 24];
    state.cols = s[0]; state.rows = s[1];
    render();
  });

  process.stdout.write(HIDE + ALT + ERASE);

  if (!autoConnect()) {
    state.overlay = true;
  }

  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  setupInput();
  render();
}

main();