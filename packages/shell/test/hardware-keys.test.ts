import { expect, test } from "bun:test";
import { HardwareKeys } from "../src/system/keys.ts";
import type { OsdState } from "../src/system/osd-state.ts";
import { stepped, type Volume } from "../src/system/volume.ts";

/** A machine whose `wpctl` answers a volume and keeps what it was asked. */
function machine(standIn: boolean) {
  const asked: string[] = [];
  const shown: OsdState[] = [];
  const told: Volume[] = [];
  let muted = false;
  const run = async (command: readonly string[]): Promise<string | null> => {
    asked.push(command.slice(0, 2).join(" "));
    if (command[1] === "set-mute") muted = !muted;
    return command[1] === "get-volume" ? `Volume: 0.50${muted ? " [MUTED]" : ""}` : "";
  };
  const keys = new HardwareKeys({ run, osd: { show: (state) => void shown.push(state) }, volumeChanged: (volume) => void told.push(volume), standIn });
  return { keys, asked, shown, told };
}

test("a step is a sixteenth, never past the ends; louder unmutes", () => {
  expect(stepped({ level: 0.5, muted: true }, "up")).toEqual({ level: 0.5625, muted: false });
  expect(stepped({ level: 0.5, muted: true }, "down")).toEqual({ level: 0.4375, muted: true });
  expect(stepped({ level: 0.98, muted: false }, "up").level).toBe(1);
  expect(stepped({ level: 0.02, muted: false }, "down").level).toBe(0);
});

test("on a development run the volume and mute keys read the machine's sound and write nothing to it", async () => {
  const { keys, asked, shown, told } = machine(true);
  await keys.run("volume-up");
  await keys.run("volume-up");
  await keys.run("volume-mute");
  await keys.run("mic-mute");
  // Read once for each of the output and the microphone; never a set-volume or a set-mute.
  expect(asked).toEqual(["wpctl get-volume", "wpctl get-volume"]);
  // What the keys set is kept and shown, each press going on from the last.
  expect(told).toEqual([
    { level: 0.5625, muted: false },
    { level: 0.625, muted: false },
    { level: 0.625, muted: true },
  ]);
  expect(shown.at(-2)).toEqual({ kind: "volume", level: 0.625, muted: true });
  expect(shown.at(-1)).toEqual({ kind: "mic", muted: true });
});

test("in the machine's own session the keys change its sound", async () => {
  const { keys, asked, told } = machine(false);
  await keys.run("volume-up");
  await keys.run("volume-mute");
  expect(asked).toEqual(["wpctl get-volume", "wpctl set-volume", "wpctl get-volume", "wpctl set-mute", "wpctl get-volume"]);
  expect(told.at(-1)).toEqual({ level: 0.5, muted: true });
});
