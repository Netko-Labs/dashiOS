import { expect, test } from "bun:test";
import type { CompositorEvent, Pointers } from "../src/compositor/index.ts";
import { PointerDevices } from "../src/system/pointers.ts";
import { settle } from "./support/time.ts";

/** A dashi-comp that answers `pointers` and can say a device came or went. */
function compositor(answer: Pointers | Error) {
  const listeners = new Set<(event: CompositorEvent) => void>();
  return {
    pointers: async (): Promise<Pointers> => {
      if (answer instanceof Error) throw answer;
      return answer;
    },
    on(listener: (event: CompositorEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    say(pointers: Pointers): void {
      for (const listener of listeners) listener({ event: "pointers", ...pointers });
    },
    listeners,
  };
}

test("nothing is known until dashi-comp says, and a trackpad is taken to be there", async () => {
  const devices = new PointerDevices();
  expect(devices.getSnapshot()).toBeNull();
  expect(devices.hasTrackpad).toBe(true);
  // An older dashi-comp refuses the method: still not known.
  devices.follow(compositor(new Error("unknown method pointers")));
  await settle();
  expect(devices.getSnapshot()).toBeNull();
  expect(devices.hasTrackpad).toBe(true);
});

test("it asks once and then follows a mouse coming and going", async () => {
  const comp = compositor({ touchpad: true, mouse: false });
  const devices = new PointerDevices();
  let heard = 0;
  devices.subscribe(() => heard++);
  const stop = devices.follow(comp);
  await settle();
  expect(devices.getSnapshot()).toEqual({ touchpad: true, mouse: false });
  comp.say({ touchpad: true, mouse: true });
  expect(devices.getSnapshot()).toEqual({ touchpad: true, mouse: true });
  // The same again is not news.
  comp.say({ touchpad: true, mouse: true });
  expect(heard).toBe(2);
  comp.say({ touchpad: false, mouse: true });
  expect(devices.hasTrackpad).toBe(false);
  stop();
  expect(comp.listeners.size).toBe(0);
});

test("an event that comes before the answer is not overwritten by it", async () => {
  const comp = compositor({ touchpad: true, mouse: false });
  const devices = new PointerDevices();
  devices.follow(comp);
  comp.say({ touchpad: true, mouse: true });
  await settle();
  expect(devices.getSnapshot()).toEqual({ touchpad: true, mouse: true });
});
