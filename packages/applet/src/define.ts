/**
 * `defineApplet`: an applet as state and what to show for it. The item, its
 * menu, and its popover are functions of the state; `set` changes it and
 * everything follows (the whole applet is sent again, the popover
 * re-renders). A click opens the popover when there is one, or closes it.
 *
 *   export default defineApplet({
 *     initial: { mode: "Balanced" },
 *     glyph: FAN,
 *     label: (s) => s.mode,
 *     menu: (s) => [{ id: "quiet", label: "Quiet", checked: s.mode === "Quiet" }],
 *     onSelect: (item, applet) => applet.set({ mode: item }),
 *     popover: { width: 300, height: 260, component: Panel },
 *   });
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ComponentType, createElement, useSyncExternalStore } from "react";
import { type AppletSpec, AppletsClient, type PopoverPlacement } from "./client.ts";
import { type Manifest, readManifest } from "./manifest.ts";
import type { MenuRowSpec } from "./menu.ts";
import { type OpenPopover, openPopoverWindow } from "./popover.tsx";
import { appletsSocketPath } from "./protocol.ts";

/** How a logged message starts on stderr, for `dashi-applet dev`. */
export const LOG_MARK = "\u241edashi-applet ";

type Of<S, T> = T | ((state: S) => T);

export interface PopoverProps<S> {
  state: S;
  set(next: Partial<S> | ((state: S) => S)): void;
  /** Closes the popover (a choice made in it). */
  close(): void;
}

export interface AppletDefinition<S> {
  /** The item's id; the last part of the manifest's id by default. */
  id?: string;
  /** Who it is; the manifest's name by default. */
  title?: string;
  initial: S;
  glyph?: Of<S, string | undefined>;
  icon?: Of<S, string | undefined>;
  label?: Of<S, string | undefined>;
  tooltip?: Of<S, string | undefined>;
  attention?: Of<S, boolean>;
  menu?: Of<S, readonly MenuRowSpec[]>;
  onSelect?(item: string, applet: AppletHandle<S>): void;
  /** A click on the item when there is no popover. */
  onActivate?(applet: AppletHandle<S>, x: number, y: number): void;
  popover?: { width: number; height: number; component: ComponentType<PopoverProps<S>> };
  /** Runs once at the start (live data, timers); what it returns runs at the end. */
  start?(applet: AppletHandle<S>): undefined | (() => void);
  /** Testing and the CLI: a client of your own, the manifest given. */
  client?: AppletsClient;
  manifest?: Manifest;
}

export interface AppletHandle<S> {
  readonly state: S;
  set(next: Partial<S> | ((state: S) => S)): void;
  openPopover(): void;
  closePopover(): void;
  readonly client: AppletsClient;
  stop(): void;
}

/** applet.json beside the running file or above it (`DASHI_APPLET_MANIFEST` names it outright). */
export function findManifest(env: Record<string, string | undefined> = process.env, from: string = dirname(Bun.main)): Manifest | null {
  const named = env.DASHI_APPLET_MANIFEST;
  let dir = from;
  for (let depth = 0; depth < 6 && !named; depth++) {
    if (existsSync(join(dir, "applet.json"))) break;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  const path = named ?? join(dir, "applet.json");
  if (!existsSync(path)) return null;
  const manifest = readManifest(readFileSync(path, "utf8"));
  if ("error" in manifest) {
    console.error(`dashi applets: ${path}: ${manifest.error}`);
    return null;
  }
  return manifest;
}

const value = <S, T>(of: Of<S, T>, state: S): T => (typeof of === "function" ? (of as (state: S) => T)(state) : of);

export function defineApplet<S>(definition: AppletDefinition<S>): AppletHandle<S> {
  const manifest = definition.manifest ?? findManifest();
  const client =
    definition.client ??
    new AppletsClient({
      path: appletsSocketPath(),
      ...(manifest ? { manifest } : {}),
      dev: process.env.DASHI_APPLET_DEV === "1",
      // `dashi-applet dev` shows each message (cli/log.ts reads these lines).
      ...(process.env.DASHI_APPLET_LOG === "1"
        ? { onMessage: (direction: "in" | "out", line: string) => console.error(`${LOG_MARK}${direction} ${line}`) }
        : {}),
    });
  const itemId = definition.id ?? manifest?.id.split(".").at(-1) ?? "applet";
  const title = definition.title ?? manifest?.name ?? itemId;
  let state = definition.initial;
  const listeners = new Set<() => void>();
  let popover: OpenPopover | null = null;

  const spec = (): AppletSpec => {
    const pick = <T>(of: Of<S, T> | undefined): T | undefined => (of === undefined ? undefined : value(of, state));
    const glyph = pick(definition.glyph);
    const icon = pick(definition.icon);
    const label = pick(definition.label);
    const tooltip = pick(definition.tooltip);
    const menu = pick(definition.menu);
    return {
      id: itemId,
      title,
      ...(glyph === undefined ? {} : { glyph }),
      ...(icon === undefined ? {} : { icon }),
      ...(label === undefined ? {} : { label }),
      ...(tooltip === undefined ? {} : { tooltip }),
      ...(menu === undefined || menu.length === 0 ? {} : { menu }),
      // With a popover, a click opens it; the menu stays on a right-click.
      ...(definition.popover ? { click: "activate" as const } : {}),
      ...(pick(definition.attention) ? { attention: true } : {}),
    };
  };

  const Popover = (): ReturnType<typeof createElement> | null => {
    const now = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => state,
    );
    return definition.popover ? createElement(definition.popover.component, { state: now, set: handle.set, close: handle.closePopover }) : null;
  };

  const placed = (placement: PopoverPlacement): void => {
    popover?.close();
    popover = openPopoverWindow({
      appId: manifest?.id ?? `applet.${itemId}`,
      title,
      placement,
      element: createElement(Popover),
      onClosed: () => {
        popover = null;
        client.dismiss(itemId);
      },
    });
  };

  const handle: AppletHandle<S> = {
    get state() {
      return state;
    },
    set(next) {
      state = typeof next === "function" ? next(state) : { ...state, ...next };
      client.show(spec());
      for (const listener of listeners) listener();
    },
    openPopover() {
      if (definition.popover && !client.isPopoverOpen(itemId)) client.requestPopover(itemId, definition.popover);
    },
    closePopover() {
      popover?.close();
      client.dismiss(itemId);
    },
    client,
    stop() {
      handle.closePopover();
      stopStart?.();
      client.remove(itemId);
      client.close();
    },
  };

  client.show(spec(), {
    onActivate: (x, y) => {
      if (!definition.popover) return definition.onActivate?.(handle, x, y);
      if (client.isPopoverOpen(itemId)) handle.closePopover();
      else handle.openPopover();
    },
    onSelect: (item) => definition.onSelect?.(item, handle),
    onPopover: placed,
    onDismiss: () => popover?.close(),
  });
  const stopStart = definition.start?.(handle);
  return handle;
}
