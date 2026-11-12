/**
 * The writing side of the user's settings file, `~/.config/dashi/settings.json`
 * (or under `$XDG_CONFIG_HOME`). The shell reads the same file and applies
 * what dashi-comp can do (input devices, the keyboard layout, idle blanking);
 * System Settings is what writes it, so a change made there reaches the shell
 * through the file, and a hand edit shows up in Settings.
 *
 *   {
 *     "input": { "touchpad": { "tap": true, … }, "mouse": { … } },
 *     "keyboard": { "layout": "de", "variant": "nodeadkeys", "repeatRate": 30, … },
 *     "idle": { "blankAfterSeconds": 300 },
 *     "appearance": { "cornerRadius": "medium", "reduceMotion": false,
 *                     "wallpaper": { "path": "aurora", "mode": "fill", "photos": ["/home/me/a.jpg"],
 *                                    "kind": "shader", "shader": "aurora", "fps": 30, "pauseOnBattery": true } },
 *     "nightShift": { "from": "21:00", "to": "07:00", "kelvin": 3400 },
 *     "dock": { "style": "taskbar", "autohide": true, "visible": true },
 *     "clock": { "hour24": true, "showDate": false },
 *     "region": { "formats": "de_DE.UTF-8", "firstWeekday": "monday" },
 *     "displays": { "eDP-1": { "scale": 1.5, "refresh": "fixed" } },
 *     "spaces": { "count": 3, "names": ["Work", null], "switchOnActivate": true },
 *     "power": { "mode": "automatic", "chargeLimit": 80 },
 *     "graphics": { "mode": "automatic" },
 *     "clipboard": { "history": true, "leftOut": ["org.keepassxc.KeePassXC"], "snippetsInTerminals": false },
 *     "screenSharing": { "clients": ["/usr/bin/grim"] },
 *     "applets": { "catalogs": [{ "name": "Team", "url": "https://example.com/index.json", "key": "RWQ…" }] }
 *   }
 *
 * Writes are read-modify-write on the file as it is now, so keys this module
 * does not know (another section, a setting from a newer shell) survive, and
 * atomic: a temp file in the same directory, flushed, then renamed over the
 * file, so a crash never leaves half a file for the shell's watcher to read
 * (shared/settings/write.ts).
 * Every value is checked before it is written and again when it is read; a
 * value of the wrong kind is ignored on read (and kept in the file until the
 * person changes that setting).
 */

import { existsSync, readFileSync, watch } from "node:fs";
import { basename, dirname } from "node:path";
import { UndoStack } from "@dashi/ui";
import { isVrrMode, type VrrMode } from "../display-config/monitors.ts";
import { isRefreshChoice, type RefreshChoice } from "../display-config/refresh-policy.ts";
import { type Check, ensure, isRaw, prune, type Raw, settingsPath, updateSettingsFile } from "../shared/settings/index.ts";
import { changesPath } from "./lib/changes/file.ts";
import { ChangeLog, type Change as LoggedChange } from "./lib/changes/log.ts";
import { describeChanges } from "./lib/changes/words.ts";
import { type Change, isOutputName, isScale, readSettings, SECTIONS, type SectionName } from "./sections.ts";
import type { SettingsData } from "./types.ts";

/** What a view of the store sees: the settings, and why the last save failed (null when it did not). */
export interface SettingsSnapshot {
  data: SettingsData;
  error: string | null;
}

export class SettingsStore {
  private snapshot: SettingsSnapshot;
  private readonly listeners = new Set<() => void>();
  /** Edit › Undo in System Settings: each change the log names (changes/). */
  readonly undo = new UndoStack();
  /** Every change people make to a setting: who, what, from what, when (Settings › Recently changed). */
  readonly changes: ChangeLog;

  /**
   * `path` is the settings file; tests point it into a temporary directory.
   * `changesFile` keeps the change log; a store with a file of its own keeps
   * it in memory unless one is given.
   */
  constructor(
    readonly path: string = settingsPath(),
    changesFile: string | null = path === settingsPath() ? changesPath() : null,
  ) {
    this.snapshot = { data: readSettings(this.readFile()), error: null };
    this.changes = new ChangeLog({ undo: this.undo, describe: describeChanges, path: changesFile });
    // Undo writes a section's keys back through `patch`, which checks them again.
    for (const name of Object.keys(SECTIONS) as SectionName[]) {
      this.changes.attach(name, {
        read: (field) => (this.snapshot.data[name] as Record<string, unknown>)[field],
        write: (field, value) => this.patch(name, { [field]: value ?? undefined } as Change<typeof name>),
      });
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SettingsSnapshot => this.snapshot;

  /** The scale saved for a screen, if the person chose one. */
  displayScale(name: string): number | undefined {
    return this.snapshot.data.displays[name]?.scale;
  }

  /** Read the file again (it may have been edited); listeners hear only a real change. */
  reload(): void {
    const next = readSettings(this.readFile());
    if (JSON.stringify(next) === JSON.stringify(this.snapshot.data)) return;
    this.snapshot = { data: next, error: this.snapshot.error };
    this.notify();
  }

  /**
   * Set keys of a section. A key set to `undefined` is removed, which puts
   * that setting back to its default. Throws on a key or value Settings does
   * not know (a bug in the caller); a failure to save is reported through
   * the snapshot's `error` and the file is left as it was. A change that was
   * saved is told to the change log (`changes`), as one entry, which puts it
   * on `undo` when it is one people make.
   */
  patch<S extends SectionName>(section: S, change: Change<S>): void {
    const spec = SECTIONS[section];
    const fields: Record<string, Check> = spec.fields;
    const entries = Object.entries(change);
    for (const [key, value] of entries) {
      const check = fields[key];
      if (!check) throw new TypeError(`unknown setting ${spec.path.join(".")}.${key}`);
      if (value !== undefined && !check(value)) throw new TypeError(`bad value for ${spec.path.join(".")}.${key}: ${JSON.stringify(value)}`);
    }
    // What each key held, as Settings read it (a value of the wrong kind in the file reads as not set).
    const held = this.snapshot.data[section] as Record<string, unknown>;
    const changes: LoggedChange[] = entries.map(([key, value]) => ({ key: `${section}.${key}`, from: held[key], to: value }));
    this.update((root) => {
      const target = ensure(root, spec.path);
      for (const [key, value] of entries) {
        if (value === undefined) delete target[key];
        else target[key] = value;
      }
      prune(root, spec.path);
    });
    if (this.snapshot.error === null) this.changes.record(changes);
  }

  /** The variable refresh rate saved for a screen, if the person chose one. */
  displayVrr(name: string): VrrMode | undefined {
    return this.snapshot.data.displays[name]?.vrr;
  }

  /** Remember the variable refresh rate chosen for a screen (`undefined` forgets it). */
  setDisplayVrr(name: string, vrr: VrrMode | undefined): void {
    if (!isOutputName(name)) throw new TypeError(`bad screen name: ${JSON.stringify(name)}`);
    if (vrr !== undefined && !isVrrMode(vrr)) throw new TypeError(`bad refresh rate mode: ${JSON.stringify(vrr)}`);
    this.update((root) => {
      const screen = ensure(ensure(root, ["displays"]), [name]);
      if (vrr === undefined) delete screen.vrr;
      else screen.vrr = vrr;
      prune(root, ["displays", name]);
    });
  }

  /** Automatic refresh rate or a rate the person picked, for a screen (Automatic when nothing is saved). */
  displayRefresh(name: string): RefreshChoice {
    return this.snapshot.data.displays[name]?.refresh ?? "automatic";
  }

  /** Remember whether a screen's rate is Automatic; Automatic is the default, so it is written as nothing. */
  setDisplayRefresh(name: string, choice: RefreshChoice): void {
    if (!isOutputName(name)) throw new TypeError(`bad screen name: ${JSON.stringify(name)}`);
    if (!isRefreshChoice(choice)) throw new TypeError(`bad refresh rate choice: ${JSON.stringify(choice)}`);
    this.update((root) => {
      const screen = ensure(ensure(root, ["displays"]), [name]);
      if (choice === "automatic") delete screen.refresh;
      else screen.refresh = choice;
      prune(root, ["displays", name]);
    });
  }

  /** Remember the scale chosen for a screen (`undefined` forgets it). */
  setDisplayScale(name: string, scale: number | undefined): void {
    if (!isOutputName(name)) throw new TypeError(`bad screen name: ${JSON.stringify(name)}`);
    if (scale !== undefined && !isScale(scale)) throw new TypeError(`bad scale: ${JSON.stringify(scale)}`);
    this.update((root) => {
      const screen = ensure(ensure(root, ["displays"]), [name]);
      if (scale === undefined) delete screen.scale;
      else screen.scale = scale;
      prune(root, ["displays", name]);
    });
  }

  /** Follow the file: edits made by hand or by another program show up. Returns a stop function. */
  watch(): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const watcher = watch(dirname(this.path), (_event, name) => {
        if (name && name !== basename(this.path)) return;
        clearTimeout(timer);
        timer = setTimeout(() => this.reload(), 100);
      });
      watcher.on("error", () => {});
      return () => {
        clearTimeout(timer);
        watcher.close();
      };
    } catch {
      return () => {};
    }
  }

  /** The file decoded; `{}` when it is missing, unreadable, or not a JSON object. */
  private readFile(): Raw {
    if (!existsSync(this.path)) return {};
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      if (isRaw(value)) return value;
    } catch {
      // Not JSON, or unreadable: nothing to read.
    }
    return {};
  }

  /** Apply `edit` to the file as it is now and save the result. */
  private update(edit: (root: Raw) => void): void {
    try {
      const root = updateSettingsFile(this.path, edit);
      this.snapshot = { data: readSettings(root), error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`dashi-shell: could not save ${this.path}:`, message);
      this.snapshot = { ...this.snapshot, error: message };
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
