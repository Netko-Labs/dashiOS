/**
 * Where each app's last window was, so its next first window opens there
 * (decisions.md D531): per app id, the frame of the last of its windows to
 * close, the screen it was on (by the screen's identity, not its connector),
 * and how it was arranged (a tile, Fill, full screen). Pure: what is kept,
 * how the file reads, and the frame a memory gives back on the screens as
 * they are now. memory-file.ts keeps it on disk.
 */

import { bool, int, literal, maybe, nullable, obj, record, str, unknown } from "@dashi/shape";
import { fitFrame, type Output, placeNew, type Rect, screenFor, TILES, type Tile, tileFrame } from "../../layout.ts";

/** What is kept of one app's last window. */
export interface WindowMemory {
  /** The screen's identity (display-config's `identityOf`). */
  screen: string;
  /** Its outer frame, from the top left of that screen. */
  frame: Rect;
  tile: Tile | null;
  fullscreen: boolean;
  /** When it closed (ms since the epoch): the oldest go first past `MOST_APPS`. */
  at: number;
}

/** Apps remembered at most; the longest unopened are forgotten first. */
export const MOST_APPS = 256;
const MOST_ID = 255;
/** The largest side a frame may have in the file (points): a bigger one is not a window's. */
const MOST_SIDE = 32_768;

const side = int({ min: 1, max: MOST_SIDE });
const offset = int({ min: -MOST_SIDE, max: MOST_SIDE });
const MemoryShape = obj(
  {
    screen: str({ min: 1, max: 512 }),
    frame: obj({ x: offset, y: offset, width: side, height: side }, { strict: false }),
    tile: nullable(literal(...TILES)),
    fullscreen: bool(),
    at: int({ min: 0 }),
  },
  { strict: false },
);
const FileShape = obj({ version: literal(1), apps: record(unknown(), { max: MOST_APPS * 4 }) }, { strict: false });

/** The file's memories; a damaged entry is dropped alone, a damaged file is none. */
export function parseMemory(value: unknown): Map<string, WindowMemory> {
  const file = maybe(FileShape, value);
  const kept = new Map<string, WindowMemory>();
  if (!file) return kept;
  for (const [appId, entry] of Object.entries(file.apps)) {
    const memory = appId.length > 0 && appId.length <= MOST_ID ? maybe(MemoryShape, entry) : null;
    if (memory) kept.set(appId, { ...memory, frame: { ...memory.frame } });
  }
  return trimmed(kept);
}

/** The newest `MOST_APPS`. */
function trimmed(memories: Map<string, WindowMemory>): Map<string, WindowMemory> {
  if (memories.size <= MOST_APPS) return memories;
  const newest = [...memories].sort(([, a], [, b]) => b.at - a.at).slice(0, MOST_APPS);
  return new Map(newest);
}

/** The file's text for `memories`. */
export function memoryText(memories: ReadonlyMap<string, WindowMemory>): string {
  return `${JSON.stringify({ version: 1, apps: Object.fromEntries(trimmed(new Map(memories))) }, null, 2)}\n`;
}

/** `memories` with `appId`'s memory put in (or a new map, as it was, for an id that can't be kept). */
export function withMemory(memories: ReadonlyMap<string, WindowMemory>, appId: string, memory: WindowMemory): Map<string, WindowMemory> {
  const next = new Map(memories);
  if (appId.length === 0 || appId.length > MOST_ID) return next;
  next.delete(appId);
  next.set(appId, memory);
  return trimmed(next);
}

/**
 * What to keep of a window that closed at `frame` (for a full-screen one, the
 * frame it goes back to), on the screens as they are: null when no screen
 * holds it or the screen has no identity.
 */
export function memoryOf(frame: Rect, arranged: { tile: Tile | null; fullscreen: boolean }, outputs: readonly Output[], at: number): WindowMemory | null {
  const screen = holding(frame, outputs);
  if (!screen?.identity) return null;
  const relative = { x: frame.x - screen.frame.x, y: frame.y - screen.frame.y, width: frame.width, height: frame.height };
  return { screen: screen.identity, frame: relative, tile: arranged.tile, fullscreen: arranged.fullscreen, at };
}

/** The screen holding the frame's center, and no other. */
function holding(frame: Rect, outputs: readonly Output[]): Output | null {
  const screen = screenFor(frame, outputs);
  if (!screen) return null;
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const inside = cx >= screen.frame.x && cx < screen.frame.x + screen.frame.width && cy >= screen.frame.y && cy < screen.frame.y + screen.frame.height;
  return inside ? screen : null;
}

/** Where a remembered window opens, and how it is arranged. */
export interface Recalled {
  frame: Rect;
  tile: Tile | null;
  fullscreen: boolean;
}

/**
 * The frame `memory` gives back: on its screen if that screen is here,
 * pulled inside what the bar and Dock leave free there (its tile there, if
 * it was tiled or filled); else on `active` (the usable area of the screen
 * the person works on) at the same size, where a new window opens.
 */
export function recall(memory: WindowMemory, outputs: readonly Output[], active: Rect): Recalled {
  const screen = outputs.find((output) => output.identity === memory.screen);
  const { tile, fullscreen } = memory;
  if (screen) {
    const frame = { ...memory.frame, x: memory.frame.x + screen.frame.x, y: memory.frame.y + screen.frame.y };
    return { frame: tile ? tileFrame(tile, screen.usable) : fitFrame(frame, screen.usable), tile, fullscreen };
  }
  if (tile) return { frame: tileFrame(tile, active), tile, fullscreen };
  const at = placeNew(memory.frame, active, 0);
  return { frame: fitFrame({ ...at, width: memory.frame.width, height: memory.frame.height }, active), tile: null, fullscreen };
}
