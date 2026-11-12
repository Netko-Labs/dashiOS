import { expect, test } from "bun:test";
import type { AppletShellMessage } from "@dashi/applet";
import { type PopoverHost, PopoverSlot } from "../src/applets/lib/popover-slot.ts";
import { flush } from "./support/time.ts";

test("a popover asked for while another's grant is on its way keeps its own grant", async () => {
  const asked: boolean[] = [];
  const waiting: Array<() => void> = [];
  const sent: AppletShellMessage[] = [];
  const host: PopoverHost = {
    pid: 4242,
    context: {
      screen: async () => ({ width: 1920, height: 1080, barHeight: 28, output: "eDP-1" }),
      grants: {
        // The compositor answers each grant when the test lets it.
        set: (_pid: number, on: boolean) => {
          asked.push(on);
          return on ? new Promise<void>((done) => waiting.push(done)) : Promise.resolve();
        },
      },
    } as unknown as PopoverHost["context"],
    isClosed: () => false,
    isApplet: () => true,
    namespace: () => "dashi-applet-4242",
    send: (message) => void sent.push(message),
    refuse: (error) => {
      throw new Error(error);
    },
  };
  const slot = new PopoverSlot(host);
  const size = { width: 200, height: 120 };
  const first = slot.show("fans", size);
  await flush();
  const second = slot.show("battery", size);
  await flush();
  // The first one's grant lands late, after the second took its place.
  for (const done of waiting.splice(0)) done();
  await Promise.all([first, second]);
  // Granted, taken back as the second replaced it, granted again: and that is the last word.
  expect(asked).toEqual([true, false, true]);
  expect(slot.id).toBe("battery");
  expect(sent.filter((message) => message.type === "popover").map((message) => message.id)).toEqual(["battery"]);
});
