<div align="center">

```
██████╗ ███████╗███╗   ███╗ ██████╗ ██████╗
██╔══██╗██╔════╝████╗ ████║██╔═══██╗██╔══██╗
██║  ██║█████╗  ██╔████╔██║██║   ██║██║  ██║
██║  ██║██╔══╝  ██║╚██╔╝██║██║   ██║██║  ██║
██████╔╝███████╗██║ ╚═╝ ██║╚██████╔╝██████╔╝
╚═════╝ ╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═════╝
```

**Demodulate the signal. Find the note.**

A full-screen chromatic tuner TUI for Linux and macOS.  
PipeWire-native · ≤5¢ accuracy · 4 visual palettes · desktop-ready.

[![License: BSD-3-Clause](https://img.shields.io/badge/license-BSD--3--Clause-39ff14?style=flat-square)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?style=flat-square&logo=bun)](https://bun.sh)
[![Nix](https://img.shields.io/badge/packaged%20with-Nix-5277C3?style=flat-square&logo=nixos)](flake.nix)
[![NixOS module](https://img.shields.io/badge/NixOS-module-7EB5E0?style=flat-square&logo=nixos)](flake.nix)

</div>

---

## What it does

DEMOD captures raw PCM from your audio interface, runs autocorrelation with parabolic interpolation on each 8192-sample frame, and resolves pitch to within 5 cents across the full instrument range (40 Hz – 1600 Hz). The name is literal: you're demodulating a complex overtone carrier to recover the baseband fundamental — the same mathematical move as an FM discriminator, just in the time domain.

The interface is divided into three full-screen zones:

```
┌────────────────────────────────────────────────────┐
│  FREQ 440.00 Hz        ██████╗                     │
│  Target  440.00 Hz     ██╔══██╗                    │  Zone A — Note
│  Note    A4            ██║  ██║  oct 4              │
│  +0.0¢                 ██████╔╝                    │
│  ✓ IN TUNE             ╚═════╝                     │
├────────────────────────────────────────────────────┤
│  [·····················♦·····················]     │  Zone B — Arc needle
│   -50        -25       0       +25        +50      │
├────────────────────────────────────────────────────┤
│  ▁▂▄▆▇█▇▅▃▂▁▂▃▄▅▆▅▄▃▂▁▂▄▅▆▇█▇▆▄▃▂▁▂▃▄▅▄▃▂▁       │  Zone C — Spectrum
│  HIST ▄▅▄▅▄▄▄▄▅▄▄▄▄▄▄▄▄   VU ████████████░░░░     │
├────────────────────────────────────────────────────┤
│  PW  Built-in Audio Analog Stereo    i:input  q:quit│  Status bar
└────────────────────────────────────────────────────┘
```

---

## Quick start

**No install needed:**

```bash
nix run github:ALH477/demod          # desktop launcher (opens a terminal window)
nix run github:ALH477/demod#tui      # raw TUI, attach to your own terminal
```

**Install into profile:**

```bash
nix profile install github:ALH477/demod
demod-desktop   # GUI desktop launcher
demod           # raw TUI
```

**Without Nix:**

```bash
git clone https://github.com/ALH477/demod
cd demod
bun run src/demod.ts
```

Requires [Bun](https://bun.sh) ≥ 1.0 and one of: `pw-record` (PipeWire), `arecord` (ALSA), or `sox` (macOS).

---

## Installation

### Nix flake — user profile

```bash
nix profile install github:ALH477/demod
```

### NixOS — system-wide module

Add to your system `flake.nix`:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    demod.url   = "github:ALH477/demod";
  };

  outputs = { nixpkgs, demod, ... }: {
    nixosConfigurations.mymachine = nixpkgs.lib.nixosSystem {
      modules = [
        demod.nixosModules.default
        {
          programs.demod.enable = true;
          # installs demod + demod-desktop, ensures PipeWire is on
        }
      ];
    };
  };
}
```

### Home Manager

```nix
{ inputs, ... }: {
  home.packages = [ inputs.demod.packages.${pkgs.system}.default ];
}
```

---

## Audio backends

DEMOD probes for backends in this order and uses the first one found:

| Backend | Binary | Notes |
|---|---|---|
| **PipeWire** | `pw-record` | Preferred on modern Linux. Full device enumeration via `--list-targets`. |
| **ALSA** | `arecord` | Fallback. Device list from `arecord -l`. |
| **CoreAudio** | `sox` | macOS only. Install via `brew install sox`. |

---

## Visual palettes

Cycle with `Tab`. Each palette has a distinct character set, color temperature, and box-drawing style.

| Palette | Aesthetic | Box style |
|---|---|---|
| **PHOSPHOR** | CRT green on near-black | Double-line `╔══╗` |
| **CINDER** | Forge ember / amber | Heavy `┏━━┓` |
| **PLASMA** | Ultraviolet synthwave | Rounded `╭──╮` |
| **ARCTIC** | Cold precision blue | Dashed `╭╌╌╮` |

---

## Keyboard reference

| Key | Action |
|---|---|
| `Tab` | Cycle palette |
| `i` or `Esc` | Open / close device selector overlay |
| `↑` `↓` | Navigate device list |
| `Enter` | Select device and begin capture |
| `q` / `Ctrl-C` | Quit |

---

## Desktop integration

`demod-desktop` is a launcher script that opens a correctly-sized, styled terminal window and runs `demod` inside it. It probes for terminal emulators in preference order:

```
foot → kitty → alacritty → wezterm → gnome-terminal → xterm
```

Each emulator is launched with:
- Geometry: **100 columns × 36 rows**
- Background: `#080e08` (near-black green tint)
- WM class: `demod` (for compositor window rules)

The `.desktop` entry and multi-resolution icons (16 px – 512 px + SVG) are installed to the standard XDG paths so DEMOD appears in your application launcher.

**Sway / i3 — float and size the window:**

```
# sway config
for_window [app_id="demod"] floating enable, resize set 900 600
```

```
# i3 config
for_window [class="demod"] floating enable
```

---

## DSP notes

Pitch detection uses the **autocorrelation method** with parabolic interpolation on the correlation peak for sub-sample period accuracy:

```
τ_refined = τ_peak + (r[τ-1] - r[τ+1]) / (2 · (2r[τ] - r[τ-1] - r[τ+1]))
f = SR / τ_refined
```

Frame size is 8192 samples at 44.1 kHz (~186 ms), giving ~5 complete cycles at 27 Hz (low A) for stable detection. Pitch output is exponentially smoothed (α = 0.28) to suppress frame-to-frame jitter without introducing sluggish response.

The spectral display uses log-spaced autocorrelation energy bands (80 Hz – 4 kHz), not FFT magnitude — so it naturally emphasises harmonically relevant content without windowing artefacts.

---

## Project structure

```
demod/
├── flake.nix                 # Nix flake: package, devShell, NixOS module
├── flake.lock
├── src/
│   └── demod.ts              # Entire application (~600 lines, zero npm deps)
├── assets/
│   └── demod.svg             # Phosphor-green meter icon (vectorized)
├── desktop/
│   ├── demod.desktop         # XDG desktop entry
│   └── demod-launch.sh       # Terminal autodetect launcher
└── README.md
```

---

## Development

```bash
nix develop                  # dev shell: bun + pipewire + alsa-utils + foot + kitty + tsserver
bun run src/demod.ts         # run directly
nix build                    # build the package
nix run .#tui                # run the built TUI
```

The dev shell drops you in with a welcome banner and all audio tools on `$PATH`. TypeScript language server is included for editor integration.

---

## License

Copyright (c) 2026 ALH477

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

See [LICENSE](LICENSE) for the full BSD 3-Clause text.
