import { afterAll, beforeAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeEvent, NativeTransport } from "@mirinjs/metal";

/** A scratch folder for the file's windows: XDG_RUNTIME_DIR and HOME point at it while its tests run. */
export function scratchHome(): { dir: string } {
  const scratch = { dir: "" };
  let runtime: string | undefined;
  let home: string | undefined;
  beforeAll(() => {
    scratch.dir = mkdtempSync(join(tmpdir(), "dashi-editor-view-"));
    // Save As starts in Documents, as a new document's does.
    mkdirSync(join(scratch.dir, "Documents"));
    // No menus socket here: the kit's menus client stays quiet.
    runtime = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = scratch.dir;
    // Open and Save As are Files' chooser, which starts at home: home is the scratch folder.
    home = process.env.HOME;
    process.env.HOME = scratch.dir;
  });
  afterAll(() => {
    if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = runtime;
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
    rmSync(scratch.dir, { recursive: true, force: true });
  });
  return scratch;
}

// The window mounted on a stand-in for the Metal host: what it sends, and events sent back as the host would.
export function fakeHost(): { transport: NativeTransport; trees: string[]; emit: (event: NativeEvent) => void } {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const emit = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  return { transport, trees, emit };
}

export const press = (nodeId: string): NativeEvent => ({ type: "press", nodeId });
