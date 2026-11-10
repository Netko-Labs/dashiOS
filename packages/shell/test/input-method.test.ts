import { expect, test } from "bun:test";
import { type Child, InputMethodRunner, inputMethodCommand } from "../src/input-method.ts";
import { parseSettings } from "../src/settings.ts";
import { settle } from "./support/time.ts";

/** A child that exits when the test says, or when killed. */
function fakeChild(log: string[], command: readonly string[]): Child & { exit(code: number): void } {
  let done: (code: number | null) => void = () => {};
  const exited = new Promise<number | null>((resolve) => {
    done = resolve;
  });
  log.push(`start ${command.join(" ")}`);
  return {
    exited,
    kill: () => {
      log.push("kill");
      done(null);
    },
    exit: (code) => done(code),
  };
}

function runner(installed: boolean) {
  const log: string[] = [];
  const children: ReturnType<typeof fakeChild>[] = [];
  const env: Record<string, string | undefined> = {};
  const ime = new InputMethodRunner({
    has: () => installed,
    env,
    wait: async () => {},
    spawn: (command) => {
      const child = fakeChild(log, command);
      children.push(child);
      return child;
    },
  });
  return { ime, log, children, env };
}

test("settings: the input method is none unless one offered is named", () => {
  expect(parseSettings({}).settings.inputMethod.engine).toBe("none");
  expect(parseSettings({ inputMethod: { engine: "fcitx5" } }).settings.inputMethod.engine).toBe("fcitx5");
  const wrong = parseSettings({ inputMethod: { engine: "ibus" } });
  expect(wrong.settings.inputMethod.engine).toBe("none");
  expect(wrong.problems).toHaveLength(1);
});

test("fcitx5 runs as the shell's own child, never daemonized, and only when installed", () => {
  expect(inputMethodCommand("fcitx5", () => true)).toEqual(["fcitx5", "--replace"]);
  expect(inputMethodCommand("fcitx5", () => false)).toBeNull();
  expect(inputMethodCommand("none", () => true)).toBeNull();
  const { ime, log } = runner(false);
  ime.apply("fcitx5");
  expect(log).toEqual([]);
  expect(ime.running).toBe(false);
});

test("picking it starts it and tells X11 apps; none stops it; the same pick twice does nothing", () => {
  const { ime, log, env } = runner(true);
  ime.apply("fcitx5");
  ime.apply("fcitx5");
  expect(log).toEqual(["start fcitx5 --replace"]);
  expect(env.XMODIFIERS).toBe("@im=fcitx");
  ime.apply("none");
  expect(log).toEqual(["start fcitx5 --replace", "kill"]);
  expect(env.XMODIFIERS).toBeUndefined();
  expect(ime.running).toBe(false);
});

test("one that quits on its own is started again, a few times, then left", async () => {
  const { ime, log, children } = runner(true);
  ime.apply("fcitx5");
  for (let round = 0; round < 4; round++) {
    children.at(-1)?.exit(1);
    await settle();
  }
  expect(log.filter((line) => line.startsWith("start"))).toHaveLength(4);
  expect(ime.running).toBe(false);
});
