/**
 * Applets' controls in Control Center (protocol 5, docs/applets.md "Version
 * 5: Control Center"), the shell's side. What an applet declares in
 * applet.json is in Add before it ever runs (the installed ones'); while it
 * is connected its state comes over its connection and presses go back as
 * `control-action`. When it isn't connected its tiles keep the last state
 * they had (kept in `$XDG_STATE_HOME/dashi/applet-controls.json`, so a
 * restart keeps it too), dimmed, and a press starts it.
 *
 * An applet's updates are applied at most 4 times a second per control (a
 * newer one waiting replaces the one before), so a busy applet can't make
 * the panel redraw without end.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type AppletControl,
  type AppletShellMessage,
  CONTROL_LIMITS,
  type ControlUpdate,
  checkUpdate,
  type InstalledApplet,
  type Manifest,
  parseGlyph,
} from "@dashi/applet";
import { isRecord } from "@dashi/shape";
import { type AppletTile, type AppletTileSource, appletTileKey, type TileAction } from "../control-center/applet-tiles.ts";
import { PUZZLE } from "../control-center/glyphs.ts";
import type { Layout } from "../control-center/layout.ts";

/** What a control last said. */
export interface ControlState {
  on?: boolean;
  detail?: string | null;
  choice?: string;
  value?: number;
  glyph?: string;
}

interface Declared {
  appletId: string;
  appletName: string;
  controls: readonly AppletControl[];
  /** Each control's glyph from its manifest icon. */
  icons: ReadonlyMap<string, string>;
}

interface Peer {
  appletId: string;
  send(message: AppletShellMessage): void;
  /** The `shown` it was last told, to tell it only of a change; null before the first. */
  told: string | null;
}

export interface AppletControlsOptions {
  /** The person's layout, and its changes (control-center/layout-store.ts). */
  layout(): Layout;
  subscribeLayout(listener: () => void): () => void;
  /** Where the last states are kept; null keeps them in memory (tests). */
  statePath?: string | null;
  /** Reads a manifest icon (an .svg in the applet's folder); null when it can't. */
  readIcon?(path: string): string | null;
  now?(): number;
  later?(fn: () => void, ms: number): () => void;
}

export function controlStatePath(env: Record<string, string | undefined> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "dashi", "applet-controls.json");
}

/** The kept states; anything that isn't one is left out. */
export function parseStates(text: string): Map<string, ControlState> {
  const out = new Map<string, ControlState>();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return out;
  }
  if (!isRecord(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (!key.startsWith("applet:") || !isRecord(entry)) continue;
    const { on, detail, choice, value: number } = entry;
    out.set(key, {
      ...(typeof on === "boolean" ? { on } : {}),
      ...(typeof detail === "string" && detail.length <= CONTROL_LIMITS.detail ? { detail } : {}),
      ...(typeof choice === "string" && choice.length <= CONTROL_LIMITS.choice ? { choice } : {}),
      ...(typeof number === "number" && Number.isFinite(number) ? { value: number } : {}),
    });
  }
  return out;
}

const SPACING_MS = 1000 / CONTROL_LIMITS.updatesPerSecond;

const defaultReadIcon = (path: string): string | null => {
  try {
    const markup = parseGlyph(readFileSync(path, "utf8"));
    return typeof markup === "string" ? markup : null;
  } catch {
    return null;
  }
};

export class AppletControls implements AppletTileSource {
  private installed = new Map<string, Declared>();
  /** Applets that aren't installed (a developer's, a script's) while their connection is open. */
  private readonly live = new Map<string, Declared>();
  private readonly peers = new Map<string, Peer>();
  private states: Map<string, ControlState>;
  private readonly applied = new Map<string, { at: number; waiting: { update: ControlState; cancel: () => void } | null }>();
  private snapshot: readonly AppletTile[] = [];
  private readonly listeners = new Set<() => void>();
  private wake: (appletId: string) => void = () => {};
  private saveTimer: (() => void) | null = null;
  private readonly now: () => number;
  private readonly later: (fn: () => void, ms: number) => () => void;
  private readonly path: string | null;

  constructor(private readonly options: AppletControlsOptions) {
    this.path = options.statePath === undefined ? controlStatePath() : options.statePath;
    this.now = options.now ?? Date.now;
    this.later =
      options.later ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      });
    let kept = new Map<string, ControlState>();
    if (this.path) {
      try {
        kept = parseStates(readFileSync(this.path, "utf8"));
      } catch {
        // Nothing kept yet.
      }
    }
    this.states = kept;
    options.subscribeLayout(() => this.tellShown());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly AppletTile[] => this.snapshot;

  /** What starts an applet that isn't running (the launcher's `wake`). */
  setWake(wake: (appletId: string) => void): void {
    this.wake = wake;
  }

  /** The installed applets that may run: their declared controls are in Add from now on. */
  setInstalled(applets: readonly InstalledApplet[]): void {
    const read = this.options.readIcon ?? defaultReadIcon;
    this.installed = new Map(
      applets
        .filter((applet) => applet.manifest.controls.length > 0 && applet.manifest.permissions.some((permission) => permission.kind === "controls"))
        .map((applet): [string, Declared] => {
          const icons = new Map<string, string>();
          for (const control of applet.manifest.controls) {
            const markup = control.icon ? read(join(applet.dir, control.icon)) : null;
            if (markup) icons.set(control.id, markup);
          }
          return [applet.manifest.id, { appletId: applet.manifest.id, appletName: applet.manifest.name, controls: applet.manifest.controls, icons }];
        }),
    );
    this.publish();
  }

  /**
   * A protocol 5 connection with controls: its presses go to `send`. Returns
   * what takes its updates (a reason when one is refused) and what ends it.
   */
  attach(peer: { manifest: Manifest; send: (message: AppletShellMessage) => void }): {
    receive(update: ControlUpdate): string | null;
    detach(): void;
  } {
    const { manifest } = peer;
    const id = manifest.id;
    const live = !this.installed.has(id);
    if (live) this.live.set(id, { appletId: id, appletName: manifest.name, controls: manifest.controls, icons: new Map() });
    const entry: Peer = { appletId: id, send: peer.send, told: null };
    this.peers.set(id, entry);
    this.tellShown();
    this.publish();
    return {
      receive: (update) => {
        const control = manifest.controls.find((each) => each.id === update.id);
        if (!control) return `control: there is no control “${update.id}” in applet.json`;
        const refused = checkUpdate(control, update);
        if (refused) return refused;
        const { id: _id, ...state } = update;
        this.update(appletTileKey(id, update.id), state);
        return null;
      },
      detach: () => {
        if (this.peers.get(id) !== entry) return;
        this.peers.delete(id);
        if (live) this.live.delete(id);
        this.publish();
      },
    };
  }

  act(key: string, action: TileAction): void {
    const tile = this.snapshot.find((each) => each.key === key);
    if (!tile) return;
    const peer = this.peers.get(tile.appletId);
    if (!peer) return this.wake(tile.appletId);
    const controlId = key.slice(`applet:${tile.appletId}/`.length);
    const sent: AppletShellMessage =
      action.kind === "toggle"
        ? { type: "control-action", id: controlId, action: "toggle", on: action.on }
        : action.kind === "choose"
          ? { type: "control-action", id: controlId, action: "choose", choice: action.choice }
          : action.kind === "set"
            ? { type: "control-action", id: controlId, action: "set", value: action.value }
            : { type: "control-action", id: controlId, action: action.kind };
    peer.send(sent);
  }

  /** An update applied now, or after the last one's quarter second. */
  private update(key: string, state: ControlState): void {
    const last = this.applied.get(key);
    const now = this.now();
    if (last?.waiting) {
      last.waiting.update = { ...last.waiting.update, ...state };
      return;
    }
    const wait = last ? last.at + SPACING_MS - now : 0;
    if (wait <= 0) return this.apply(key, state);
    const waiting = { update: state, cancel: () => {} };
    waiting.cancel = this.later(() => this.apply(key, waiting.update), wait);
    this.applied.set(key, { at: last?.at ?? 0, waiting });
  }

  private apply(key: string, state: ControlState): void {
    this.applied.set(key, { at: this.now(), waiting: null });
    this.states.set(key, { ...this.states.get(key), ...state });
    this.publish();
    this.scheduleSave();
  }

  /** Each connected applet hears which of its controls are in the layout, when that changed. */
  private tellShown(): void {
    const layout = this.options.layout();
    for (const peer of this.peers.values()) {
      const prefix = `applet:${peer.appletId}/`;
      const shown = layout.filter((item) => item.id.startsWith(prefix)).map((item) => item.id.slice(prefix.length));
      const line = JSON.stringify(shown);
      if (line === peer.told) continue;
      peer.told = line;
      peer.send({ type: "controls", shown });
    }
  }

  private publish(): void {
    const declared = new Map([...this.installed, ...this.live]);
    this.snapshot = [...declared.values()].flatMap((applet) =>
      applet.controls.map((control): AppletTile => {
        const key = appletTileKey(applet.appletId, control.id);
        const state = this.states.get(key) ?? {};
        return {
          key,
          appletId: applet.appletId,
          appletName: applet.appletName,
          kind: control.kind,
          title: control.title,
          sizes: control.sizes,
          glyph: state.glyph ?? applet.icons.get(control.id) ?? PUZZLE,
          on: state.on ?? false,
          detail: state.detail ?? (control.kind === "choice" ? (state.choice ?? null) : null),
          choices: control.choices,
          choice: state.choice ?? null,
          min: control.min,
          max: control.max,
          value: state.value ?? null,
          running: this.peers.has(applet.appletId),
        };
      }),
    );
    for (const listener of [...this.listeners]) listener();
  }

  private scheduleSave(): void {
    if (!this.path || this.saveTimer) return;
    this.saveTimer = this.later(() => {
      this.saveTimer = null;
      this.save();
    }, 1000);
  }

  private save(): void {
    if (!this.path) return;
    const kept = Object.fromEntries([...this.states].map(([key, { glyph: _glyph, ...state }]) => [key, state]));
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, `${JSON.stringify(kept)}\n`);
    } catch (error) {
      console.error("dashi-shell: could not keep the applets' controls:", error);
    }
  }
}
