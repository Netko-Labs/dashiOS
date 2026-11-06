/**
 * Opening Settings at a row: a `dashi://settings/<pane>/<row>` address
 * (actions/) opens the pane, scrolls the row into view, and lights it up for
 * a moment. Every registered row is a Spot (setting.tsx `Setting`), and a
 * pane wraps other content a row of the registry stands for in `<Spot id>`;
 * the id is the address without `dashi://settings/` (registry/).
 *
 * The page scrolls by the row's distance from its top, measured once both
 * are laid out (the scroll is relative, so a pane already scrolled works
 * too). The light is the switcher's soft wash, gone after `LIT_MS`.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, View } from "@mirinjs/metal";
import { createContext, type ReactNode, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { rowPlace, type SettingId } from "./registry/index.ts";

/** How long a row stays lit. */
export const LIT_MS = 2_500;
/** Room left above the row once it is scrolled to. */
const ABOVE = 24;
/** The row and its page report their layout in either order: look again this often, this many times. */
const LAYOUT_POLL_MS = 50;
const LAYOUT_POLLS = 20;

export interface RowTarget {
  pane: string;
  row: string;
  /** Each request is its own: asking for the same row again lights it again. */
  serial: number;
}

/** Which row was asked for, until it has been shown. */
export class RowFocus {
  private target: RowTarget | null = null;
  private serial = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RowTarget | null => this.target;

  request(pane: string, row: string): void {
    this.target = { pane, row, serial: ++this.serial };
    this.notify();
  }

  /** The light went out (only the request it was for). */
  clear(serial: number): void {
    if (this.target?.serial !== serial) return;
    this.target = null;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** How far to scroll so the row sits `ABOVE` below the page's top; 0 when it is already in view. */
export function scrollFor(row: Bounds, page: Bounds): number {
  const top = row.y - page.y;
  const visible = top >= ABOVE && top + row.height <= page.height;
  return visible ? 0 : top - ABOVE;
}

export interface SpotHost {
  focus: RowFocus;
  /** Scroll the page with this testID by `dy` points (down is positive); absent where it can't be. */
  scroll?(testID: string, dy: number): void;
}

export const SpotContext = createContext<SpotHost | null>(null);

/** The page a Spot is on: its testID and its last layout (ui.tsx `Page`). */
export const PageContext = createContext<{ testID: string; bounds: { current: Bounds | null } } | null>(null);

const NO_FOCUS = { subscribe: () => () => {}, getSnapshot: (): RowTarget | null => null };

/** A row with an address: scrolled to and lit when it is asked for. */
export function Spot({ id, children }: { id: SettingId; children: ReactNode }) {
  const { pane, row } = rowPlace({ id });
  const colors = useColors();
  const host = useContext(SpotContext);
  const page = useContext(PageContext);
  const store = host?.focus ?? NO_FOCUS;
  const target = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const lit = target !== null && target.pane === pane && target.row === row ? target : null;
  const bounds = useRef<Bounds | null>(null);
  const scrolled = useRef<number | null>(null);

  // Scrolled once per request, as soon as the row and its page have been laid out.
  const reveal = (): void => {
    if (!lit || scrolled.current === lit.serial || !bounds.current || !page?.bounds.current) return;
    scrolled.current = lit.serial;
    const dy = scrollFor(bounds.current, page.bounds.current);
    if (dy !== 0) host?.scroll?.(page.testID, dy);
  };
  const revealNow = useRef(reveal);
  revealNow.current = reveal;

  useEffect(() => {
    if (!lit || !host) return;
    let polls = 0;
    const poll = setInterval(() => {
      revealNow.current();
      if (scrolled.current === lit.serial || ++polls >= LAYOUT_POLLS) clearInterval(poll);
    }, LAYOUT_POLL_MS);
    revealNow.current();
    const timer = setTimeout(() => host.focus.clear(lit.serial), LIT_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(timer);
    };
  }, [lit, host]);

  return (
    <View
      testID={`spot:${row}`}
      onLayout={(laid) => {
        bounds.current = laid;
        reveal();
      }}
      style={{ flexDirection: "column", backgroundColor: lit ? colors.switcherSelection : "#00000000" }}
    >
      {children}
    </View>
  );
}
