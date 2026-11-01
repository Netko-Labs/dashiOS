/**
 * The app switcher, as on the Mac: while ❖ is held, Tab and ⇧Tab step
 * through apps in most-recently-used order and Esc cancels; letting ❖ go
 * brings the chosen app forward. The panel shows once ❖Tab has been held a
 * moment, so a quick ❖Tab flips to the last app without it. The keymap binds
 * the keys (keymap.ts); the compositor reports when ❖ comes up.
 */

import { Image, Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import type { Compositor, CompositorWindow } from "./compositor.ts";
import { useColors } from "@dashi/ui";

export interface SwitcherApp {
  appId: string;
  title: string;
}

export interface SwitcherState {
  selected: number;
  apps: SwitcherApp[];
}

const ICON = 64;
const CELL = ICON + 16;
const GAP = 12;
const PAD = 14;
/** Room around the panel for its shadow. */
const MARGIN = 24;

export function switcherSize(count: number): { width: number; height: number } {
  return {
    width: count * CELL + Math.max(count - 1, 0) * GAP + PAD * 2 + MARGIN * 2,
    height: CELL + 26 + PAD * 2 + MARGIN * 2,
  };
}

/** A ❖Tab held this long shows the panel. */
const SHOW_AFTER_MS = 150;

export type Step = "next" | "previous";

/** `index` moved one step through `length` items, wrapping. */
export function stepIndex(index: number, length: number, step: Step): number {
  if (length === 0) return 0;
  return step === "next" ? (index + 1) % length : (index + length - 1) % length;
}

/** One window per app, most recently used first. The compositor lists
 * windows front to back, then minimized (latest first), then hidden, so an
 * app's first window is the one to bring forward. */
export function appsByRecency(windows: readonly CompositorWindow[]): CompositorWindow[] {
  const seen = new Set<string>();
  return windows.filter((window) => {
    const app = window.pid !== null ? `pid:${window.pid}` : `app:${window.appId}`;
    if (seen.has(app)) return false;
    seen.add(app);
    return true;
  });
}

interface Session {
  apps: CompositorWindow[];
  selected: number;
  shown: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/** The switcher's state between ❖Tab and letting ❖ go. Steps, cancels, and
 * commits run in order, so a quick ❖Tab can't commit before its step. */
export class SwitcherController {
  private session: Session | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly compositor: Compositor,
    private readonly panel: { show(state: SwitcherState): void; hide(): void },
  ) {}

  step(step: Step): void {
    this.enqueue(() => this.move(step));
  }

  cancel(): void {
    this.enqueue(() => this.end(false));
  }

  /** ❖ came up: bring the chosen app forward. */
  commit(): void {
    this.enqueue(() => this.end(true));
  }

  private enqueue(operation: () => Promise<void>): void {
    this.queue = this.queue.then(operation).catch((error) => console.error("dashi-shell: switcher:", error));
  }

  private state(session: Session): SwitcherState {
    return { selected: session.selected, apps: session.apps.map(({ appId, title }) => ({ appId, title })) };
  }

  private async move(step: Step): Promise<void> {
    const current = this.session;
    if (current) {
      current.selected = stepIndex(current.selected, current.apps.length, step);
      if (current.shown) this.panel.show(this.state(current));
      return;
    }
    const apps = appsByRecency(await this.compositor.windows());
    if (apps.length < 2) return;
    const session: Session = { apps, selected: stepIndex(0, apps.length, step), shown: false };
    session.timer = setTimeout(() => {
      if (this.session !== session) return;
      session.shown = true;
      this.panel.show(this.state(session));
    }, SHOW_AFTER_MS);
    this.session = session;
  }

  private async end(commit: boolean): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.session = null;
    clearTimeout(session.timer);
    if (session.shown) this.panel.hide();
    const chosen = session.apps[session.selected];
    // Focusing a minimized or hidden window brings it back too.
    if (commit && chosen) await this.compositor.request("focus", { window: chosen.id });
  }
}

/** The current request, for the open panel to re-render from. */
export class SwitcherStore {
  private state: SwitcherState = { selected: 0, apps: [] };
  private readonly listeners = new Set<() => void>();

  set(state: SwitcherState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SwitcherState => this.state;
}

export function SwitcherPanel({
  store,
  identify,
}: {
  store: SwitcherStore;
  identify: (app: SwitcherApp) => { name: string; icon: string };
}) {
  const colors = useColors();
  const { selected, apps } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const current = apps[selected];
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          padding: PAD,
          borderRadius: 22,
          backgroundColor: colors.launcher,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        <View style={{ flexDirection: "row", gap: GAP }}>
          {apps.map((app, index) => (
            <View
              key={`${index}:${app.appId}`}
              style={{
                width: CELL,
                height: CELL,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 16,
                backgroundColor: index === selected ? colors.switcherSelection : "#00000000",
              }}
            >
              <Image source={identify(app).icon} style={{ width: ICON, height: ICON }} />
            </View>
          ))}
        </View>
        <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
          {current ? identify(current).name : ""}
        </Text>
      </View>
    </View>
  );
}
