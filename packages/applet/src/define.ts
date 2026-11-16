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

import { dirname } from "node:path";
import { createElement, useSyncExternalStore } from "react";
import { AppletsClient } from "./client.ts";
import type { AppletSpec, PopoverPlacement } from "./client-types.ts";
import { type ControlsApi, controlsApi } from "./controls-api.ts";
import { commandHandlers } from "./define-commands.ts";
import type { AppletDefinition, AppletHandle, Of } from "./define-types.ts";
import { LauncherViews, type ViewCommand } from "./launcher/views.ts";
import type { Manifest } from "./manifest.ts";
import { findManifest, manifestPath, sendIcons } from "./manifest-file.ts";
import { metalHost, type OpenPopover, openPopoverWindow } from "./popover.tsx";
import { appletsSocketPath } from "./protocol.ts";
import { WarmHost } from "./warm-host.ts";

/** How a logged message starts on stderr, for `dashi-applet dev`. */
export const LOG_MARK = "\u241edashi-applet ";

const value = <S, T>(of: Of<S, T>, state: S): T => (typeof of === "function" ? (of as (state: S) => T)(state) : of);

/** The client an applet talks to the shell with, unless `definition.client` gave one. */
function clientFor(manifest: Manifest | null): AppletsClient {
  return new AppletsClient({
    path: appletsSocketPath(),
    ...(manifest ? { manifest } : {}),
    dev: process.env.DASHI_APPLET_DEV === "1",
    // An applet runs until it is stopped: a shell restart has it wait and connect again, not quit.
    keepAlive: true,
    // `dashi-applet dev` shows each message (cli/lib/log.ts reads these lines).
    ...(process.env.DASHI_APPLET_LOG === "1" ? { onMessage: (direction: "in" | "out", line: string) => console.error(`${LOG_MARK}${direction} ${line}`) } : {}),
  });
}

/** What the applet shows for `state`: the item, its menu and its click. */
function specOf<S>(definition: AppletDefinition<S>, state: S, itemId: string, title: string): AppletSpec {
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
}

/** The applet's popover, drawn again whenever its state changes. */
function popoverView<S>(definition: AppletDefinition<S>, listeners: Set<() => void>, handle: () => AppletHandle<S>) {
  return (): ReturnType<typeof createElement> | null => {
    const applet = handle();
    const now = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => applet.state,
    );
    return definition.popover ? createElement(definition.popover.component, { state: now, set: applet.set, close: applet.closePopover }) : null;
  };
}

export function defineApplet<S>(definition: AppletDefinition<S>): AppletHandle<S> {
  const manifest = definition.manifest ?? findManifest();
  const client = definition.client ?? clientFor(manifest);
  const itemId = definition.id ?? manifest?.id.split(".").at(-1) ?? "applet";
  const title = definition.title ?? manifest?.name ?? itemId;
  // An extension with only launcher views has no state of its own.
  let state = definition.initial as S;
  const listeners = new Set<() => void>();
  let popover: OpenPopover | null = null;
  let controls: ControlsApi | null = null;
  const warm = warmHostFor(definition, title);
  warm?.start();

  const spec = (): AppletSpec => specOf(definition, state, itemId, title);

  const placed = (placement: PopoverPlacement): void => {
    popover?.close();
    popover = openPopoverWindow({
      appId: manifest?.id ?? `applet.${itemId}`,
      title,
      placement,
      element: createElement(popoverView(definition, listeners, () => handle)),
      warm,
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
      const now = spec();
      if (now.glyph !== undefined || now.icon !== undefined || now.label !== undefined) client.show(now);
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
    get controls() {
      if (!controls) {
        controls = controlsApi(client, () => handle.openPopover());
        const path = definition.manifest ? null : manifestPath();
        sendIcons(client, manifest, path ? dirname(path) : null);
      }
      return controls;
    },
    stop() {
      handle.closePopover();
      warm?.stop();
      stopStart?.();
      client.remove(itemId);
      client.close();
    },
  };

  wire(definition, handle, { manifest, title, listeners, warm, placed, itemId, popover: () => popover });
  const stopStart = definition.start?.(handle);
  return handle;
}

/** The item and its handlers (an extension with only commands shows nothing in the menu bar), the commands and the launcher's views. */
function wire<S>(
  definition: AppletDefinition<S>,
  handle: AppletHandle<S>,
  parts: {
    manifest: Manifest | null;
    title: string;
    listeners: Set<() => void>;
    warm: WarmHost | null;
    itemId: string;
    placed(placement: PopoverPlacement): void;
    popover(): OpenPopover | null;
  },
): void {
  const { client } = handle;
  const first = specOf(definition, handle.state, parts.itemId, parts.title);
  if (first.glyph !== undefined || first.icon !== undefined || first.label !== undefined)
    client.show(first, {
      onActivate: (x, y) => {
        if (!definition.popover) return definition.onActivate?.(handle, x, y);
        if (client.isPopoverOpen(parts.itemId)) handle.closePopover();
        else handle.openPopover();
      },
      onSelect: (item) => definition.onSelect?.(item, handle),
      onPopover: parts.placed,
      onDismiss: () => parts.popover()?.close(),
    });
  if (!definition.commands) return;
  const views = new LauncherViews(treeViews(definition.commands), (message) => client.sendView(message));
  client.onCommands(commandHandlers(definition.commands, handle, parts.manifest, parts.title, parts.listeners, parts.warm), (message) =>
    views.receive(message),
  );
}

/**
 * The warm host for an applet with a popover or a view: its views draw at
 * once in the launcher, not a second or two later (warm-host.ts).
 */
function warmHostFor<S>(definition: AppletDefinition<S>, title: string): WarmHost | null {
  if (definition.warmHost !== undefined) return definition.warmHost;
  const views = Object.values(definition.commands ?? {}).some((command) => command.view && typeof command.view === "object");
  return definition.popover || views ? new WarmHost({ binary: metalHost(), appName: title }) : null;
}

/** The commands whose view the launcher draws (a component, for modes list, grid and detail). */
function treeViews<S>(commands: NonNullable<AppletDefinition<S>["commands"]>): Record<string, ViewCommand> {
  const views: Record<string, ViewCommand> = {};
  for (const [name, command] of Object.entries(commands)) if (typeof command.view === "function") views[name] = command.view;
  return views;
}
