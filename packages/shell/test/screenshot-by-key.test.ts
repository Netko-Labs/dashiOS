/**
 * ⇧❖3 pressed while the launcher is open (passes 31 and 39: it made no
 * file). The key reaches the session's screenshot (launcher/keys.ts), a
 * key's run says it came by key (actions/lib/run.ts), and the screenshot
 * then takes the screen as it is, the launcher in it; a Screenshot row
 * chosen in the launcher still takes the launcher down first.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAction } from "../src/actions/lib/run.ts";
import { commandActions } from "../src/actions/lib/sources/commands.ts";
import type { ActionContext } from "../src/actions/types.ts";
import { Screenshots } from "../src/boot/overlays.tsx";
import type { LateParts } from "../src/boot/parts.ts";
import { Late, Services } from "../src/boot/services.ts";
import type { Compositor } from "../src/compositor/client.ts";
import { KEYMAP } from "../src/keymap/keymap.ts";
import { NotificationStore } from "../src/notifications/store.ts";

let home = "";
const before = process.env.HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "dashi-shot-"));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = before;
  rmSync(home, { recursive: true, force: true });
});

function shots() {
  const captured: string[] = [];
  const closed: string[] = [];
  const compositor = {
    capture: async ({ path }: { path: string }) => void captured.push(path),
    windows: async () => [],
  } as unknown as Compositor;
  const late = new Late<LateParts>();
  late.set("overlays", { has: (kind: string) => kind === "launcher", closeAndWait: async (kind: string) => void closed.push(kind) } as never);
  const services = new Services();
  const screenshots = new Screenshots(compositor, { capture: null, notifications: { store: new NotificationStore() } as never }, services, late);
  return { screenshots, captured, closed, services };
}

test("⇧❖3 over the open launcher takes the screen with the launcher still up", async () => {
  const { screenshots, captured, closed, services } = shots();
  await screenshots.run("screen", null, true);
  expect(closed).toEqual([]);
  expect(captured).toHaveLength(1);
  expect(captured[0]).toStartWith(join(home, "Pictures", "Screenshots", "Screenshot "));
  services.closeAll();
});

test("the screenshot command passes on that a key asked, and a key's run says so", async () => {
  const asked: Array<[string, number | null, boolean | undefined]> = [];
  const commands = commandActions(
    async () => {},
    KEYMAP,
    async (what, window, byKey) => void asked.push([what, window, byKey]),
  );
  const shot = commands.find((action) => action.address === "dashi://dashi/screenshot");
  if (!shot) throw new Error("no screenshot command");
  const contexts: ActionContext[] = [];
  const deps = {
    context: (window: number | null): ActionContext => {
      const ctx = { window };
      contexts.push(ctx);
      return ctx;
    },
    log: () => {},
    reveal: () => {},
    confirmLink: async () => false,
  };
  await runAction(shot, {}, "key", deps, 7);
  await runAction(shot, {}, "person", deps, 7);
  expect(asked).toEqual([
    ["screen", 7, true],
    ["screen", 7, false],
  ]);
});
