/**
 * Starts the Dock: its settings, the pointer policy for autohiding, and its
 * surface on the primary screen (presenter.ts says when it exists). The
 * surface is a Metal host on a layer-shell surface of its own. The windows
 * are not its to report: the primary menu bar's host does (menubars.ts), so
 * the list outlives a hidden Dock.
 */

import { type Bounds, type NativeHostOptions, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import type { Compositor } from "../compositor.ts";
import type { Entry } from "../entries.ts";
import type { MenuController } from "../menus/index.ts";
import type { App } from "../shared/apps/index.ts";
import { spawnShellHost } from "../shared/metal/host.ts";
import { DOCK, DOCK_HEIGHT, TASKBAR } from "../theme.ts";
import type { ToplevelStore } from "../toplevels.ts";
import type { AttentionStore } from "./attention.ts";
import { Autohide } from "./autohide.ts";
import type { DockController } from "./controller.ts";
import { compositorEdges } from "./edges.ts";
import type { PinStore } from "./pins.ts";
import type { DockPrefs } from "./prefs.ts";
import { DockPresenter, specOf } from "./presenter.ts";
import { Slide } from "./slide.tsx";
import { type DockHandle, DockSurface } from "./surface.ts";
import { Taskbar } from "./taskbar.tsx";
import type { TileStore } from "./tiles.ts";
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
  /** Reduce Motion is on: the Dock appears and leaves without its entrance and exit. */
  reduceMotion?(): boolean;
}

export interface DockRuntime {
  /** The Dock goes on this screen (the primary); `undefined` leaves it to the compositor. */
  place(output: string | undefined): void;
  close(): void;
}

/** The Dock's layer-shell namespace, which `input-region` names it by. */
const DOCK_NAMESPACE = "dashi.dock";

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
      namespace: DOCK_NAMESPACE,
      ...(output === undefined ? {} : { output }),
    },
  };
}

export function startDock(options: StartDockOptions): DockRuntime {
  const { prefs, toplevels } = options;
  const autohide = new Autohide();
  const slide = new Slide(0, () => options.reduceMotion?.() ?? false);

  // The Dock's surface spans the screen's width with the panel in its middle:
  // the compositor lets clicks beside the panel through to the windows there
  // (IPC `input-region`). Sent when it changes; null is the whole surface.
  let region = "";
  const clickable = (rects: readonly Bounds[] | null) => {
    const wire = rects?.map(({ x, y, width, height }) => ({ x, y, width, height })) ?? null;
    const key = JSON.stringify(wire);
    if (key === region) return;
    region = key;
    options.compositor
      ?.request("input-region", { namespace: DOCK_NAMESPACE, rects: wire })
      .catch((error) => console.error("dashi-shell: the Dock takes clicks across the screen:", error instanceof Error ? error.message : error));
  };

  /** Opens `element` on a new host; `onClosed` runs once, however it ended. */
  const open = (hostOptions: NativeHostOptions, element: ReactElement, onClosed: () => void): DockHandle => {
    const host = spawnShellHost({ appId: "dev.dashi.shell", ...hostOptions });
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
      const taskbar = specOf(variant).style === "taskbar";
      // The taskbar takes clicks across the screen; the Dock only on its panel.
      if (taskbar) clickable(null);
      const element = taskbar ? (
        <Taskbar {...shared} autohide={autohide} />
      ) : (
        <Dock {...shared} autohide={autohide} onPanel={(bounds) => clickable([bounds])} />
      );
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
