import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { choiceLine, isPickRequest, PICKER, parseAnswer, pickerLayout, type ShareChoice, serveSharePicker, socketPath } from "../src/share-picker/index.ts";

describe("what the wlr portal reads", () => {
  test("a screen by its output, a window by its toplevel identifier", () => {
    expect(choiceLine({ kind: "screen", output: "eDP-1" })).toBe("Monitor: eDP-1");
    expect(choiceLine({ kind: "window", toplevel: "a1B2c3" })).toBe("Window: a1B2c3");
    expect(choiceLine({ kind: "screen", output: "eDP-1\nWindow: x" })).toBeNull();
    expect(choiceLine({ kind: "window", toplevel: "" })).toBeNull();
  });

  test("the command prints only an answer it understands", () => {
    expect(parseAnswer('{"choice":"Monitor: HDMI-A-1"}')).toBe("Monitor: HDMI-A-1");
    expect(parseAnswer('{"choice":null}')).toBeNull();
    expect(parseAnswer('{"choice":"rm -rf /"}')).toBeNull();
    expect(parseAnswer("not json")).toBeNull();
    expect(isPickRequest('{"pick":{}}')).toBe(true);
    expect(isPickRequest('{"quit":{}}')).toBe(false);
  });

  test("the socket is in the runtime folder, unless said otherwise", () => {
    expect(socketPath({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe("/run/user/1000/dashi-share.sock");
    expect(socketPath({ DASHI_SHARE_SOCKET: "/tmp/x.sock" })).toBe("/tmp/x.sock");
    expect(socketPath({})).toBeNull();
  });
});

describe("the picker's layout", () => {
  test("a picture per screen in its shape, four windows to a row, buttons at the bottom", () => {
    const layout = pickerLayout([16 / 9, 4 / 3], 6);
    expect(layout.screens.map((rect) => Math.round((rect.width / rect.height) * 100) / 100)).toEqual([1.78, 1.33]);
    expect(layout.windows).toHaveLength(6);
    expect(layout.windows[4]?.y).toBeGreaterThan(layout.windows[0]?.y ?? 0);
    expect(layout.windows[4]?.x).toBe(layout.windows[0]?.x);
    expect(layout.share.y).toBeGreaterThan(layout.option.y);
    expect(layout.size.height).toBe(layout.share.y + layout.share.height + PICKER.pad);
  });

  test("many screens shrink to fit; many windows stop at the most shown", () => {
    const layout = pickerLayout([16 / 9, 16 / 9, 16 / 9, 16 / 9], 40);
    const last = layout.screens.at(-1);
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual(PICKER.width - PICKER.pad);
    expect(layout.windows).toHaveLength(PICKER.windows);
    expect(pickerLayout([1], 0).windowsHeading).toBeNull();
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function socket(): string {
  const dir = mkdtempSync(join(tmpdir(), "dashi-share-"));
  dirs.push(dir);
  return join(dir, "dashi-share.sock");
}

/** Run the real command against `path`; its stdout and exit status. */
async function runPicker(path: string): Promise<{ out: string; code: number }> {
  const child = Bun.spawn(["bun", join(import.meta.dir, "../bin/dashi-share-picker.ts")], {
    env: { ...process.env, DASHI_SHARE_SOCKET: path },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(child.stdout).text();
  return { out, code: await child.exited };
}

describe("asking the shell", () => {
  test("the command prints the choice for the portal", async () => {
    const path = socket();
    const stop = serveSharePicker(path, async () => ({ kind: "screen", output: "eDP-1" }));
    try {
      expect(await runPicker(path)).toEqual({ out: "Monitor: eDP-1\n", code: 0 });
    } finally {
      stop();
    }
  });

  test("declined, or no shell: nothing printed, and never 127", async () => {
    const path = socket();
    const stop = serveSharePicker(path, async () => null);
    try {
      expect(await runPicker(path)).toEqual({ out: "", code: 1 });
    } finally {
      stop();
    }
    expect(await runPicker(path)).toEqual({ out: "", code: 1 });
  });

  test("one picker at a time; a hang-up closes it", async () => {
    const path = socket();
    let release: (choice: ShareChoice | null) => void = () => {};
    let aborted = false;
    const stop = serveSharePicker(
      path,
      (abort) =>
        new Promise((resolve) => {
          release = resolve;
          abort.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    );
    try {
      const first = runPicker(path);
      await Bun.sleep(300);
      // A second while the first is up is declined at once.
      expect(await runPicker(path)).toEqual({ out: "", code: 1 });
      release({ kind: "window", toplevel: "abc123" });
      expect(await first).toEqual({ out: "Window: abc123\n", code: 0 });

      const lines: string[] = [];
      const hangUp = await Bun.connect({ unix: path, socket: { data: (_socket, chunk) => void lines.push(new TextDecoder().decode(chunk)) } });
      hangUp.write('{"pick":{}}\n');
      await Bun.sleep(100);
      hangUp.end();
      await Bun.sleep(100);
      expect(aborted).toBe(true);
      expect(lines).toEqual([]);
      // The next one may open.
      const next = runPicker(path);
      await Bun.sleep(300);
      release({ kind: "screen", output: "DP-2" });
      expect(await next).toEqual({ out: "Monitor: DP-2\n", code: 0 });
    } finally {
      stop();
    }
  });
});
