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

/**
 * The row on screen: opened over the screen the person is on, its pictures
 * and input region sent to the compositor, and closed again. Each method is
 * one of the row's own steps; start.tsx wires them to the Spaces' events.
 */
class RowSurface {
  private row: OverlayHandle | null = null;
  /** Where the row is now, or null while it is closed. */
  placed: Placed | null = null;
  /** Bumped on each open and close, so a slow open that lost the race closes itself. */
  private generation = 0;
  /** The pictures as last sent, so the same ones are not sent again. */
  private sent = "";

  constructor(
    private readonly deps: SpacesDeps,
    private readonly controller: SpacesController,
    private readonly view: RowViewStore,
  ) {}

  /** The pictures where the opened row shows them, or none. */
  sendPreviews = (): void => {
    if (!this.placed) return;
    const { output, frame } = this.placed;
    const { open, lifted: over } = this.view.getSnapshot();
    const layout = shelfLayout(frame.width, this.controller.getSnapshot().count, aspectOf(output));
    const rects = open
      ? layout.pictures.map((picture, space) => {
          const rect = over === space ? lifted(picture) : picture;
          return { space, x: frame.x + rect.x, y: frame.y + rect.y, w: rect.width, h: rect.height };
        })
      : [];
    const message = JSON.stringify({ output: output.name, rects });
    if (message === this.sent) return;
    this.sent = message;
    void this.deps.compositor.spacePreviews({ output: output.name, rects }).catch(report("no Desktop pictures"));
  };

  /** The row takes the pointer only where it shows: the line of names, or all of it opened. */
  sendRegion = (): void => {
    if (!this.placed) return;
    const height = this.view.getSnapshot().open ? SHELF_HEIGHT : ROW.height;
    void this.deps.compositor
      .inputRegion({ namespace: NAMESPACE, rects: [{ x: 0, y: 0, width: this.placed.frame.width, height }] })
      .catch(report("the Desktops row's input region"));
  };

  close = (): void => {
    this.generation++;
    if (this.placed && this.sent !== "") void this.deps.compositor.spacePreviews({ output: this.placed.output.name, rects: [] }).catch(() => {});
    this.sent = "";
    this.row?.close();
    this.row = null;
    this.placed = null;
    this.view.reset();
  };

  open = async (): Promise<void> => {
    const { compositor } = this.deps;
    const mine = ++this.generation;
    const [name, answer] = await Promise.all([this.deps.screen(), compositor.outputs()]);
    const outputs = placedOutputs(answer);
    const output = outputs.find((candidate) => candidate.name === name) ?? outputs[0];
    if (!output || mine !== this.generation) return;
    const frame = { ...rowFrame(output.usable), height: SHELF_HEIGHT };
    this.placed = { output, frame };
    this.sendRegion();
    void this.controller.relabel();
    this.row = this.deps.open(
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
        desktops={this.controller}
        view={this.view}
        width={frame.width}
        aspect={aspectOf(output)}
        onSwitch={(index) => void this.deps.leaveOverview().then(() => this.controller.switchTo(index))}
        onAdd={() => void this.controller.add()}
        onRemove={(index) => void this.controller.remove(index)}
        onRename={(index, text) => this.controller.rename(index, text)}
        onHover={(hovered, part) => this.view.hover(hovered, part)}
        // A dragged window can't go onto a full-screen Desktop: its picture doesn't lift.
        onOverSpace={(index, over) => this.view.overSpace(index, over && (this.controller.getSnapshot().fullscreen[index] ?? null) === null)}
        onEscape={() => void this.deps.leaveOverview()}
      />,
    );
  };

  /** A window let go over the row: onto a Desktop's picture or name, or the + (a new Desktop). */
  drop = async (window: number, x: number, y: number): Promise<void> => {
    this.view.drag(null);
    if (!this.placed) return;
    const { frame, output } = this.placed;
    const count = this.controller.getSnapshot().count;
    const [rx, ry] = [x - frame.x, y - frame.y];
    const target = this.view.getSnapshot().open
      ? shelfTarget(shelfLayout(frame.width, count, aspectOf(output)), rx, ry)
      : rowTarget(rowLayout(frame.width, count), rx, ry);
    if (target) await this.controller.move(window, target.kind === "add" ? "new" : target.index);
  };
}

/** A window held against a screen's side: the next Desktop, if the policy says so (edge.ts). */
async function pushedAgainstEdge(compositor: Compositor, controller: SpacesController, event: Extract<CompositorEvent, { event: "edge-hold" }>): Promise<void> {
  const outputs = placedOutputs(await compositor.outputs());
  const target = edgeHoldTarget(event, outputs, controller.getSnapshot(), controller.getSnapshot().fullscreen);
  if (target !== null) await controller.switchTo(target);
}

export function startSpaces(deps: SpacesDeps): SpacesRuntime {
  const { compositor } = deps;
  const controller = new SpacesController(compositor, deps.saveCount, { appName: deps.appName, saveNames: deps.saveNames });
  const stopController = controller.start();
  const view = new RowViewStore();
  const row = new RowSurface(deps, controller, view);
  const stopView = view.subscribe(() => {
    row.sendRegion();
    row.sendPreviews();
  });
  // Another Desktop, or a name: the pictures follow.
  const stopDesktops = controller.subscribe(row.sendPreviews);

  const stopEvents = compositor.on((event) => {
    if (event.event === "overview-drag") view.drag(event.window);
    else if (event.event === "overview-pick") view.drag(null);
    else if (event.event === "edge-hold") void pushedAgainstEdge(compositor, controller, event).catch(report("the edge hold"));
  });

  return {
    controller,
    overviewExtras: {
      topInset: ROW.height,
      onActive: (active) => {
        if (active) void row.open().catch(report("no Spaces row"));
        else row.close();
      },
      onDrop: (window, x, y) => void row.drop(window, x, y).catch(report("the drop failed")),
    },
    close: () => {
      row.close();
      stopEvents();
      stopView();
      stopDesktops();
      stopController();
    },
  };
}
