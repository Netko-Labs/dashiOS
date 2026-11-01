/**
 * Starts the Dock: its settings, the pointer policy for autohiding, and its
 * surface on the primary screen (presenter.ts says when it exists). The
 * surface is a Metal host on a layer-shell surface of its own. The windows
 * are not its to report: the primary menu bar's host does (menubars.ts), so
 * the list outlives a hidden Dock.
 */

import { type NativeHostOptions, render, spawnNativeHost } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { type App, METAL_HOST } from "../apps.ts";
import type { Entry } from "../entries.ts";
import type { MenuController } from "../menus/index.ts";
import { DOCK, DOCK_HEIGHT, TASKBAR } from "../theme.ts";
import type { ToplevelStore } from "../toplevels.ts";
import type { AttentionStore } from "./attention.ts";
import type { Compositor } from "../compositor.ts";
import { Autohide } from "./autohide.ts";
import type { DockController } from "./controller.ts";
import { compositorEdges } from "./edges.ts";
import type { PinStore } from "./pins.ts";
import { DockPresenter, specOf } from "./presenter.ts";
import type { DockPrefs } from "./prefs.ts";
import { Slide } from "./slide.tsx";
import type { TileStore } from "./tiles.ts";
import { DockSurface, type DockHandle } from "./surface.ts";
import { Taskbar } from "./taskbar.tsx";
import { Dock } from "./view.tsx";

export interface StartDockOptions {
  prefs: DockPrefs;
  apps: readonly App[];
  catalog: readonly Entry[];
  pins: PinStore;
  toplevels: ToplevelStore;
  controller: DockController;
  menus: MenuController;
  attention: AttentionStore | null;
  /** Told where the icons are, for the compositor's minimize animation (animation-targets.ts); optional. */
  tiles?: TileStore;
  /** Null without dashi-comp: the Dock then cannot hide itself, it has no way to know where the pointer is. */
  compositor: Pick<Compositor, "request" | "on"> | null;
  /** A Dock surface's host died by itself (on `output`): the shell decides whether the screen went with it. */
  onLost(output: string | undefined): void;
}

export interface DockRuntime {
  /** The Dock goes on this screen (the primary); `undefined` leaves it to the compositor. */
  place(output: string | undefined): void;
  close(): void;
}

type Layer = Exclude<NonNullable<NativeHostOptions["surface"]>, { role: "lock" }>;

/** The layer surface of a Dock view: the floating Dock or the full-width bar, with or without a zone for windows to stop at. */
export function viewSurface(variant: string, output: string | undefined): { height: number; surface: Layer } {
  const { style, exclusive } = specOf(variant);
  const taskbar = style === "taskbar";
  const height = taskbar ? TASKBAR.height : DOCK_HEIGHT;
  const margin = taskbar ? 0 : DOCK.margin;
  return {
    height,
    surface: {
      layer: "top",
      anchor: ["bottom", "left", "right"],
      // Windows stop above the Dock; a hidden-until-needed one lies over them.
      exclusiveZone: exclusive ? height + margin : 0,
      margin: { bottom: margin },
      namespace: "dashi.dock",
      ...(output === undefined ? {} : { output }),
    },
  };
}

export function startDock(options: StartDockOptions): DockRuntime {
  const { prefs, toplevels } = options;
  const autohide = new Autohide();
  const slide = new Slide();

  /** Opens `element` on a new host; `onClosed` runs once, however it ended. */
  const open = (hostOptions: NativeHostOptions, element: ReactElement, onClosed: () => void): DockHandle => {
    const host = spawnNativeHost(METAL_HOST, { appId: "dev.dashi.shell", ...hostOptions });
    const root = render(element, host);
    let up = true;
    host.onClose(() => {
      if (!up) return;
      up = false;
      root.unmount();
      onClosed();
    });
    return {
      close() {
        if (!up) return;
        up = false;
        root.unmount();
        host.close();
      },
    };
  };

  const view = new DockSurface({
    open: (output, onClosed, variant) => {
      // A new view lays itself out and reports its tiles again.
      options.tiles?.clear();
      const { height, surface } = viewSurface(variant, output);
      const shared = {
        apps: options.apps,
        catalog: options.catalog,
        pins: options.pins,
        toplevels,
        controller: options.controller,
        menus: options.menus,
        attention: options.attention,
        prefs,
        slide,
        tiles: options.tiles ?? null,
        ...(output === undefined ? {} : { output }),
      };
      const element = specOf(variant).style === "taskbar" ? <Taskbar {...shared} autohide={autohide} /> : <Dock {...shared} autohide={autohide} />;
      return open({ title: "Dock", width: 1, height, surface }, element, onClosed);
    },
    onLost: options.onLost,
  });

  const presenter = new DockPresenter({ prefs, autohide, slide, view, edges: options.compositor && compositorEdges(options.compositor) });
  presenter.start();
  // The pointer entering or leaving the band the presenter claims along the bottom edge.
  const stopEdges = options.compositor?.on((event) => event.event === "edge" && autohide.edge(event.inside));
  // An icon's menu opens on a surface of its own, so the pointer leaves the Dock: it stays out while the menu is up.
  const stopMenus = options.menus.subscribe(() => autohide.hold("menu", options.menus.getSnapshot().popover?.kind === "dock-menu"));

  return {
    place: (output) => presenter.place(output),
    close() {
      stopMenus();
      stopEdges?.();
      presenter.close();
      autohide.close();
      slide.close();
    },
  };
}
