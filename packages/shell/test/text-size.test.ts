import { expect, test } from "bun:test";
import { parseSettings } from "../src/settings.ts";
import { TextSize } from "../src/text-size.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("settings: the text size, 1 when it is missing or not one offered", () => {
  expect(parseSettings({}).settings.appearance.textSize).toBe(1);
  const chosen = parseSettings({ appearance: { textSize: 1.3 } });
  expect(chosen.settings.appearance.textSize).toBe(1.3);
  expect(chosen.problems).toEqual([]);
  const wrong = parseSettings({ appearance: { textSize: 2 } });
  expect(wrong.settings.appearance.textSize).toBe(1);
  expect(wrong.problems).toHaveLength(1);
});

test("the shell's surfaces hear a new size; GTK apps are told once per size, only where the shell may", async () => {
  const run: string[] = [];
  const told = new TextSize({
    gate: { on: true },
    has: () => true,
    run: async (command) => {
      run.push(command.join(" "));
      return "";
    },
  });
  const heard: number[] = [];
  told.subscribe(() => heard.push(told.textSize()));
  await told.apply(1);
  await told.apply(1.5);
  await told.apply(1.5);
  await settle();
  expect(heard).toEqual([1.5]);
  expect(run).toEqual(["gsettings set org.gnome.desktop.interface text-scaling-factor 1", "gsettings set org.gnome.desktop.interface text-scaling-factor 1.5"]);

  const quiet: string[] = [];
  const gated = new TextSize({
    gate: { on: false, why: "a nested session" },
    has: () => true,
    run: async (command) => {
      quiet.push(command.join(" "));
      return "";
    },
  });
  await gated.apply(1.15);
  expect(gated.textSize()).toBe(1.15);
  expect(quiet).toEqual([]);
});
