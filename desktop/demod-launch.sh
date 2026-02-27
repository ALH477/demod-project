#!/usr/bin/env bash
# demod-launch — Desktop launcher for DEMOD chromatic tuner
# Opens a terminal window sized and styled for the TUI.
# Terminal preference order: foot > kitty > alacritty > wezterm > gnome-terminal > xterm

set -euo pipefail

DEMOD_BIN="@demod_bin@"
TITLE="DEMOD — Chromatic Tuner"
COLS=100
ROWS=36

# Font size hints (terminal-specific)
FONT_SIZE=14

launch_foot() {
  exec foot \
    --title "$TITLE" \
    --app-id demod \
    --override "colors.background=080e08" \
    --override "colors.foreground=c8ffc8" \
    --override "font=monospace:size=${FONT_SIZE}" \
    --override "pad=8x8" \
    --window-size-chars "${COLS}x${ROWS}" \
    -- "$DEMOD_BIN"
}

launch_kitty() {
  exec kitty \
    --title "$TITLE" \
    --class demod \
    --override "background=#080e08" \
    --override "foreground=#c8ffc8" \
    --override "font_size=${FONT_SIZE}" \
    --override "initial_window_width=${COLS}c" \
    --override "initial_window_height=${ROWS}c" \
    -- "$DEMOD_BIN"
}

launch_alacritty() {
  exec alacritty \
    --title "$TITLE" \
    --class demod,demod \
    --option "colors.primary.background='#080e08'" \
    --option "colors.primary.foreground='#c8ffc8'" \
    --option "font.size=${FONT_SIZE}" \
    --option "window.dimensions.columns=${COLS}" \
    --option "window.dimensions.lines=${ROWS}" \
    -- -e "$DEMOD_BIN"
}

launch_wezterm() {
  exec wezterm start \
    --class demod \
    -- "$DEMOD_BIN"
}

launch_gnome_terminal() {
  exec gnome-terminal \
    --title "$TITLE" \
    --geometry "${COLS}x${ROWS}" \
    -- "$DEMOD_BIN"
}

launch_xterm() {
  exec xterm \
    -title "$TITLE" \
    -geometry "${COLS}x${ROWS}" \
    -bg "#080e08" \
    -fg "#c8ffc8" \
    -fa "Monospace" \
    -fs "$FONT_SIZE" \
    -e "$DEMOD_BIN"
}

# Pick first available terminal
if command -v foot &>/dev/null; then
  launch_foot
elif command -v kitty &>/dev/null; then
  launch_kitty
elif command -v alacritty &>/dev/null; then
  launch_alacritty
elif command -v wezterm &>/dev/null; then
  launch_wezterm
elif command -v gnome-terminal &>/dev/null; then
  launch_gnome_terminal
elif command -v xterm &>/dev/null; then
  launch_xterm
else
  # Last resort: try $TERMINAL env var
  if [[ -n "${TERMINAL:-}" ]] && command -v "$TERMINAL" &>/dev/null; then
    exec "$TERMINAL" -e "$DEMOD_BIN"
  fi
  echo "DEMOD: no supported terminal emulator found." >&2
  echo "Install one of: foot, kitty, alacritty, wezterm, gnome-terminal, xterm" >&2
  exit 1
fi
