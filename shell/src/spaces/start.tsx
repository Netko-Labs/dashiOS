/**
 * Spaces in the shell: the controller (controller.ts), and the Spaces row
 * that Mission Control shows at the top of the screen the person is on
 * (row.tsx), with what a click, the +, the ×, and a dropped window do.
 */

import type { Compositor } from "../compositor.ts";
import { parseOutputs } from "../arrange.ts";
import type { OverviewExtras } from "../overview/index.ts";
import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";
import { SpacesController } from "./controller.ts";
import { ROW, type Rect, rowFrame, rowLayout, rowTarget } from "./model.ts";
import { SpacesRow } from "./row.tsx";

export interface SpacesDeps {
  compositor: Compositor;
  open: OpenOverlay;
  /** The screen the person is on (active-screen.ts); undefined is the compositor's choice. */
  screen(): Promise<string | undefined>;
  /** Leave Mission Control at once (a click on a Space goes there). */
  leaveOverview(): Promise<void>;
  /** Remember how many Spaces there are (settings.json `spaces.count`). */
  saveCount(count: number): void;
}

export interface SpacesRuntime {
  controller: SpacesController;
  /** For the overview controller: room for the row, and the row's life. */
  overviewExtras: OverviewExtras;
  close(): void;
}

export function startSpaces(deps: SpacesDeps): SpacesRuntime {
  const controller = new SpacesController(deps.compositor, deps.saveCount);
  const stop = controller.start();
  let row: OverlayHandle | null = null;
  /** Where the row is on screen (global logical), for drops. */
  let frame: Rect | null = null;
  /** Bumped on each open and close, so a slow open that lost the race closes itself. */
  let generation = 0;

  const closeRow = () => {
    generation++;
    row?.close();
    row = null;
    frame = null;
  };

  const openRow = async () => {
    const mine = ++generation;
    const [name, answer] = await Promise.all([deps.screen(), deps.compositor.request("outputs")]);
    const outputs = parseOutputs(answer);
    const output = outputs.find((candidate) => candidate.name === name) ?? outputs[0];
    if (!output || mine !== generation) return;
    frame = rowFrame(output.usable);
    const width = frame.width;
    row = deps.open(
      {
        title: "Spaces",
        width: 1,
        height: ROW.height,
        surface: {
          layer: "overlay",
          anchor: ["top", "left", "right"],
          exclusiveZone: 0,
          namespace: "dashi.spaces",
          ...(name === undefined ? {} : { output: name }),
        },
      },
      <SpacesRow
        spaces={controller}
        width={width}
        onSwitch={(index) => void deps.leaveOverview().then(() => controller.switchTo(index))}
        onAdd={() => void controller.add()}
        onRemove={(index) => void controller.remove(index)}
      />,
    );
  };

  const dropped = async (window: number, x: number, y: number) => {
    if (!frame) return;
    const target = rowTarget(rowLayout(frame.width, controller.getSnapshot().count), x - frame.x, y - frame.y);
    if (!target) return;
    const index = target.kind === "add" ? await controller.add() : target.index;
    if (index !== null) await controller.move(window, index);
  };

  return {
    controller,
    overviewExtras: {
      topInset: ROW.height,
      onActive: (active) => {
        if (active) void openRow().catch((error) => console.error("dashi-shell: no Spaces row:", error));
        else closeRow();
      },
      onDrop: (window, x, y) => void dropped(window, x, y).catch((error) => console.error("dashi-shell: the drop failed:", error)),
    },
    close: () => {
      closeRow();
      stop();
    },
  };
}
