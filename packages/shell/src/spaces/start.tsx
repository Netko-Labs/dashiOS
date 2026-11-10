/**
 * Desktops in the shell: the controller (controller.ts), the Desktops row
 * Mission Control shows at the top of the screen the person is on (row.tsx),
 * opening into live pictures (shelf.ts, drawn by the compositor in the rects
 * sent here with `space-previews`), what a click, the +, the ×, a rename,
 * and a dropped window do (never onto a full-screen Desktop: the controller
 * refuses, and it springs back), and pushing a held window against a
 * screen's side (edge.ts, from the compositor's `edge-hold`).
 */

import { placedOutputs } from "../arrange.ts";
import type { Compositor, CompositorEvent, CompositorWindow } from "../compositor.ts";
import type { Output } from "../layout.ts";
import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";
import type { OverviewExtras } from "../overview/index.ts";
import { SpacesController } from "./controller.ts";
import { edgeHoldTarget } from "./edge.ts";
import { type Rect, ROW, rowFrame, rowLayout, rowTarget } from "./model.ts";
import type { SpaceNames } from "./names.ts";
import { SpacesRow } from "./row.tsx";
import { lifted, SHELF_HEIGHT, shelfLayout, shelfTarget } from "./shelf.ts";
import { RowViewStore } from "./view.ts";

/** The row's surface namespace (its input region is limited to what shows). */
const NAMESPACE = "dashi.spaces";

export interface SpacesDeps {
  compositor: Compositor;
  open: OpenOverlay;
  /** The screen the person is on (active-screen.ts); undefined is the compositor's choice. */
  screen(): Promise<string | undefined>;
  /** Leave Mission Control at once (a click on a Space goes there). */
  leaveOverview(): Promise<void>;
  /** Remember how many Spaces there are (settings.json `spaces.count`). */
  saveCount(count: number): void;
  /** Remember what they are called (settings.json `spaces.names`). */
  saveNames?(names: SpaceNames): void;
  /** What the Dock calls a window's app, for Desktops named after their apps. */
  appName?(window: CompositorWindow): string;
}

export interface SpacesRuntime {
  controller: SpacesController;
  /** For the overview controller: room for the row, and the row's life. */
  overviewExtras: OverviewExtras;
  close(): void;
}

/** Where the row is: its screen and its frame there (global logical). */
interface Placed {
  output: Output;
  frame: Rect;
}

const aspectOf = (output: Output) => output.frame.width / Math.max(1, output.frame.height);
const report = (what: string) => (error: unknown) => console.error(`dashi-shell: ${what}:`, error instanceof Error ? error.message : error);

export function startSpaces(deps: SpacesDeps): SpacesRuntime {
  const { compositor } = deps;
  const controller = new SpacesController(compositor, deps.saveCount, { appName: deps.appName, saveNames: deps.saveNames });
  const stopController = controller.start();
  const view = new RowViewStore();
  let row: OverlayHandle | null = null;
  let placed: Placed | null = null;
  /** Bumped on each open and close, so a slow open that lost the race closes itself. */
  let generation = 0;
  /** The pictures as last sent, so the same ones are not sent again. */
  let sent = "";

  /** The pictures where the opened row shows them, or none. */
  const sendPreviews = () => {
    if (!placed) return;
    const { output, frame } = placed;
    const { open, lifted: over } = view.getSnapshot();
    const layout = shelfLayout(frame.width, controller.getSnapshot().count, aspectOf(output));
    const rects = open
      ? layout.pictures.map((picture, space) => {
          const rect = over === space ? lifted(picture) : picture;
          return { space, x: frame.x + rect.x, y: frame.y + rect.y, w: rect.width, h: rect.height };
        })
      : [];
    const message = JSON.stringify({ output: output.name, rects });
    if (message === sent) return;
    sent = message;
    void compositor.spacePreviews({ output: output.name, rects }).catch(report("no Desktop pictures"));
  };

  /** The row takes the pointer only where it shows: the line of names, or all of it opened. */
  const sendRegion = () => {
    if (!placed) return;
    const height = view.getSnapshot().open ? SHELF_HEIGHT : ROW.height;
    void compositor
      .inputRegion({ namespace: NAMESPACE, rects: [{ x: 0, y: 0, width: placed.frame.width, height }] })
      .catch(report("the Desktops row's input region"));
  };

  const stopView = view.subscribe(() => {
    sendRegion();
    sendPreviews();
  });
  // Another Desktop, or a name: the pictures follow.
  const stopDesktops = controller.subscribe(sendPreviews);

  const closeRow = () => {
    generation++;
    if (placed && sent !== "") void compositor.spacePreviews({ output: placed.output.name, rects: [] }).catch(() => {});
    sent = "";
    row?.close();
    row = null;
    placed = null;
    view.reset();
  };

  const openRow = async () => {
    const mine = ++generation;
    const [name, answer] = await Promise.all([deps.screen(), compositor.outputs()]);
    const outputs = placedOutputs(answer);
    const output = outputs.find((candidate) => candidate.name === name) ?? outputs[0];
    if (!output || mine !== generation) return;
    const frame = { ...rowFrame(output.usable), height: SHELF_HEIGHT };
    placed = { output, frame };
    sendRegion();
    void controller.relabel();
    row = deps.open(
      {
        title: "Spaces",
        width: 1,
        height: SHELF_HEIGHT,
        surface: {
          layer: "overlay",
          anchor: ["top", "left", "right"],
          exclusiveZone: 0,
          // A press there gives it the keyboard: a rename types into it.
          keyboard: "on-demand",
          namespace: NAMESPACE,
          output: output.name,
        },
      },
      <SpacesRow
        desktops={controller}
        view={view}
        width={frame.width}
        aspect={aspectOf(output)}
        onSwitch={(index) => void deps.leaveOverview().then(() => controller.switchTo(index))}
        onAdd={() => void controller.add()}
        onRemove={(index) => void controller.remove(index)}
        onRename={(index, text) => controller.rename(index, text)}
        onHover={(hovered, part) => view.hover(hovered, part)}
        // A dragged window can't go onto a full-screen Desktop: its picture doesn't lift.
        onOverSpace={(index, over) => view.overSpace(index, over && (controller.getSnapshot().fullscreen[index] ?? null) === null)}
        onEscape={() => void deps.leaveOverview()}
      />,
    );
  };

  /** A window let go over the row: onto a Desktop's picture or name, or the + (a new Desktop). */
  const dropped = async (window: number, x: number, y: number) => {
    view.drag(null);
    if (!placed) return;
    const { frame, output } = placed;
    const count = controller.getSnapshot().count;
    const [rx, ry] = [x - frame.x, y - frame.y];
    const target = view.getSnapshot().open
      ? shelfTarget(shelfLayout(frame.width, count, aspectOf(output)), rx, ry)
      : rowTarget(rowLayout(frame.width, count), rx, ry);
    if (target) await controller.move(window, target.kind === "add" ? "new" : target.index);
  };

  /** A window held against a screen's side: the next Desktop, if the policy says so (edge.ts). */
  const held = async (event: Extract<CompositorEvent, { event: "edge-hold" }>) => {
    const outputs = placedOutputs(await compositor.outputs());
    const target = edgeHoldTarget(event, outputs, controller.getSnapshot(), controller.getSnapshot().fullscreen);
    if (target !== null) await controller.switchTo(target);
  };

  const stopEvents = compositor.on((event) => {
    if (event.event === "overview-drag") view.drag(event.window);
    else if (event.event === "overview-pick") view.drag(null);
    else if (event.event === "edge-hold") void held(event).catch(report("the edge hold"));
  });

  return {
    controller,
    overviewExtras: {
      topInset: ROW.height,
      onActive: (active) => {
        if (active) void openRow().catch(report("no Spaces row"));
        else closeRow();
      },
      onDrop: (window, x, y) => void dropped(window, x, y).catch(report("the drop failed")),
    },
    close: () => {
      closeRow();
      stopEvents();
      stopView();
      stopDesktops();
      stopController();
    },
  };
}
