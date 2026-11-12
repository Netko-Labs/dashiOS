/**
 * The Dock's settings as the shell uses them: the latest of what the file
 * says (settings/settings.ts hears every change to it) and what was just asked for
 * here (the shortcut, the Dock's menu, an agent), so a toggle takes effect
 * at once and not when the file watcher gets to it. Changes are written
 * through to settings.json, which stays the one source of truth: a hand edit
 * and System Settings reach the same place.
 */

import { DOCK_DEFAULTS, type DockSettings, sameDock } from "./settings.ts";

export class DockPrefs {
  private current: DockSettings = { ...DOCK_DEFAULTS };
  private readonly listeners = new Set<(settings: DockSettings) => void>();

  /** `write` saves a change to settings.json (the settings store's `patch`). */
  constructor(private readonly write: (change: Partial<DockSettings>) => void) {}

  get snapshot(): DockSettings {
    return this.current;
  }

  /** Hears the settings now and after each change. */
  subscribe(listener: (settings: DockSettings) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  /** The file (or the store) says these are the settings; listeners hear only a difference. */
  apply(next: DockSettings): void {
    if (sameDock(this.current, next)) return;
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }

  /** Change some settings: applied now, saved too. */
  set(change: Partial<DockSettings>): void {
    this.apply({ ...this.current, ...change });
    try {
      this.write(change);
    } catch (error) {
      console.error("dashi-shell: could not save the Dock's settings:", error instanceof Error ? error.message : error);
    }
  }

  toggleVisible(): void {
    this.set({ visible: !this.current.visible });
  }

  toggleAutohide(): void {
    this.set({ autohide: !this.current.autohide });
  }
}
