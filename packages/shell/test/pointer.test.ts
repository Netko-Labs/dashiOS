import { expect, test } from "bun:test";
import { PointerSync, pointerCommands } from "../src/pointer.ts";
import { parseSettings } from "../src/settings.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function sync(gateOn: boolean) {
  const requests: [string, unknown][] = [];
  const commands: string[] = [];
  const pointer = new PointerSync({
    compositor: {
      request: async (method, params) => {
        requests.push([method, params]);
        return {};
      },
    },
    gate: gateOn ? { on: true } : { on: false, why: "test" },
    has: (program) => program === "gsettings",
    run: async (command) => {
      commands.push(command.join(" "));
      return "";
    },
  });
  return { pointer, requests, commands };
}

test("the pointer size goes to the compositor and to GTK apps", async () => {
  const { pointer, requests, commands } = sync(true);
  await pointer.apply(32);
  expect(requests).toEqual([["cursor-size", { size: 32 }]]);
  expect(commands).toEqual(["gsettings set org.gnome.desktop.interface cursor-size 32"]);
  // The same size again: nothing new.
  await pointer.apply(32);
  expect(requests).toHaveLength(1);
  // Back to the default: apps hear it too (gsettings kept 32).
  await pointer.apply(24);
  expect(commands.at(-1)).toBe("gsettings set org.gnome.desktop.interface cursor-size 24");
});

test("where the shell may not change apps' settings, only the compositor hears", async () => {
  const { pointer, requests, commands } = sync(false);
  await pointer.apply(48);
  await settle();
  expect(requests).toEqual([["cursor-size", { size: 48 }]]);
  expect(commands).toEqual([]);
  expect(pointerCommands(48, () => false)).toEqual([]);
});

test("settings: the pointer size and X11 apps' scaling, with defaults for what's wrong", () => {
  expect(parseSettings({}).settings.appearance).toMatchObject({ pointerSize: 24, x11Apps: "sharp" });
  const chosen = parseSettings({ appearance: { pointerSize: 40, x11Apps: "stretched" } });
  expect(chosen.settings.appearance).toMatchObject({ pointerSize: 40, x11Apps: "stretched" });
  expect(chosen.problems).toEqual([]);
  const wrong = parseSettings({ appearance: { pointerSize: 30, x11Apps: "blurry" } });
  expect(wrong.settings.appearance).toMatchObject({ pointerSize: 24, x11Apps: "sharp" });
  expect(wrong.problems).toHaveLength(2);
});
