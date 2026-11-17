/**
 * The capsule marks its own critical asks (44's README, D402): a plan that
 * waits for a yes and would pay, sign in, force quit or install is
 * `critical`, so it takes the tally as asking, over a song that plays; a
 * plan that only changes a setting waits in its card.
 */

import { describe, expect, test } from "bun:test";
import { permissionsOf } from "../src/capsule/lib/told.ts";
import { decide, EMPTY_TALLY } from "../src/tally/lib/rules.ts";
import { asksOnAir, mediaOnAir } from "../src/widgets/lib/on-air.ts";

const plan = (id: string, tools: string[]) => ({
  id,
  request: "do it",
  phase: "planned" as const,
  said: "",
  steps: tools.map((tool) => ({ title: tool, tool, state: { kind: "ready" } })),
});

describe("the capsule's critical asks", () => {
  test("a plan with a critical step is marked; one without is not", () => {
    const [paying, settings] = permissionsOf([plan("a", ["set_setting", "pay"]), plan("b", ["set_setting"])], new Set(), new Map(), 1000);
    expect(paying?.critical).toBe(true);
    expect(settings?.critical).toBeUndefined();
  });

  test("a step already run does not make it critical", () => {
    const task = {
      ...plan("c", ["set_setting"]),
      steps: [
        { title: "pay", tool: "pay", state: { kind: "done" } },
        { title: "x", tool: "set_setting", state: { kind: "ready" } },
      ],
    };
    expect(permissionsOf([task], new Set(), new Map(), 0)[0]?.critical).toBeUndefined();
  });

  test("so it takes the tally from a song that holds it; a settings plan does not", () => {
    const song = mediaOnAir({
      player: "p",
      name: "Helium",
      title: "Slow Tide",
      artist: "",
      playing: true,
      length: 0,
      position: 0,
      positionAt: 0,
      art: "",
      since: 0,
    });
    const held = decide(EMPTY_TALLY, song, 0);
    expect(held.holder).toBe(song[0]?.key ?? "");
    const quiet = permissionsOf([plan("b", ["set_setting"])], new Set(), new Map(), 5_000);
    expect(decide(held, [...song, ...asksOnAir(quiet)], 5_000).holder).toBe(song[0]?.key ?? "");
    const asking = permissionsOf([plan("a", ["pay"])], new Set(), new Map(), 5_000);
    expect(decide(held, [...song, ...asksOnAir(asking)], 5_000).holder).toBe("ask:a");
  });
});
