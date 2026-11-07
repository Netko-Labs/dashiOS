import { expect, test } from "bun:test";
import { OverlaySlots } from "../src/overlay-slots.ts";

test("closing and waiting resolves once the host has exited, and at once for a host that stays up", async () => {
  const slots = new OverlaySlots<"launcher" | "sheet">();
  let exit: () => void = () => {};
  const exited = new Promise<void>((resolve) => {
    exit = resolve;
  });
  const closed: string[] = [];
  slots.show("launcher", (onClosed) => ({
    close: () => {
      closed.push("launcher");
      onClosed();
    },
    exited,
  }));
  let gone = false;
  const waiting = slots.closeAndWait("launcher").then(() => {
    gone = true;
  });
  expect(closed).toEqual(["launcher"]);
  expect(slots.has("launcher")).toBe(false);
  await Bun.sleep(1);
  expect(gone).toBe(false);
  exit();
  await waiting;
  expect(gone).toBe(true);
  // A resident host has no exit to wait for; nothing open is nothing to wait for.
  slots.show("sheet", (onClosed) => ({ close: onClosed }));
  await slots.closeAndWait("sheet");
  await slots.closeAndWait("launcher");
});
