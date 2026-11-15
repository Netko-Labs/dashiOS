#!/usr/bin/env bash
# One run of bench/dock-slide.tsx in a nested dashi-comp, in a small window.
#
#   bench/dock-slide-run.sh <comp> <host> <log> [entrances] [pinned app ids…]
#
# <comp> is a dashi-comp that reads DASHI_NESTED_SIZE, <host> the Metal host to
# measure, <log> where the bench's and the host's trace lines go. The nested
# compositor has a runtime folder and an IPC socket of its own: nothing of the
# session's is used but its Wayland display, to show the window. Environment
# given to this script reaches the host (MIRIN_METAL_TEXT, WAYLAND_DEBUG, …).
set -euo pipefail

comp=$1 host=$2 log=$3
shift 3
here=$(cd "$(dirname "$0")" && pwd)
session_runtime=${XDG_RUNTIME_DIR:?}
runtime=$(mktemp -d "$session_runtime/dock-slide.XXXXXX")
trap 'rm -rf "$runtime"' EXIT

# The session's display by its full path, since the runtime folder is another.
case ${WAYLAND_DISPLAY:?} in
/*) display=$WAYLAND_DISPLAY ;;
*) display=$session_runtime/$WAYLAND_DISPLAY ;;
esac

export DOCK_BENCH_ARGS="$*"
cd "$here/.."
# The compositor runs the command with its own shell: the variables are for that shell.
# shellcheck disable=SC2016
env WAYLAND_DISPLAY="$display" XDG_RUNTIME_DIR="$runtime" DASHI_COMP_SOCKET="$runtime/comp.sock" \
  DASHI_NESTED_SIZE="${DASHI_NESTED_SIZE:-1200x300}" \
  DASHI_METAL_HOST="$host" MIRIN_METAL_TRACE=1 MIRIN_METAL_SCALE="${MIRIN_METAL_SCALE:-1.75}" \
  DOCK_BENCH_NESTED=1 DOCK_BENCH_LOG="$log" \
  "$comp" --backend winit --no-xwayland \
  -c 'exec bun bench/dock-slide.tsx $DOCK_BENCH_ARGS >>"$DOCK_BENCH_LOG" 2>&1' >/dev/null 2>&1
