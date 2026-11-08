/**
 * ⇧❖5's toolbar says when it didn't show: a host that went before drawing,
 * one slow to draw, and a press while one is still opening (which does
 * nothing). 15-nits step 7: the first ⇧❖5 during an agent's recording
 * seemed to open nothing, and nothing said why.
 */

import { expect, test } from "bun:test";
import { type NativeEvent, type NativeHostTransport, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import type { OpenOverlay } from "../src/overlay.tsx";
import type { RecorderState } from "../src/recorder/recorder.ts";
import { recordRefusal } from "../src/recorder/start.ts";
import { captureToolbar, SLOW_DRAW_MS } from "../src/recorder/toolbar.tsx";

const settle = (ms = 5): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** An overlay opener whose host draws (or doesn't) when the test says, and goes when closed or when it dies. */
function fakeOpen() {
  const opened: { frame(): void; die(): void; close(): void }[] = [];
  const open: OpenOverlay = (_options, _element, onClosed, onHost) => {
    const listeners: ((event: NativeEvent) => void)[] = [];
    let exit: () => void = () => {};
    const exited = new Promise<void>((resolve) => {
      exit = resolve;
    });
    onHost?.({ onEvent: (listener: (event: NativeEvent) => void) => listeners.push(listener) } as unknown as NativeHostTransport);
    let open = true;
    const finish = () => {
      if (!open) return;
      open = false;
      onClosed?.();
      exit();
    };
    opened.push({
      frame: () => {
        for (const listener of listeners) listener({ type: "frame" } as unknown as NativeEvent);
      },
      die: finish,
      close: finish,
    });
    return { exited, close: finish, scroll() {} };
  };
  return { open, opened };
}

function setup() {
  const reports: string[] = [];
  let clock = 0;
  const { open, opened } = fakeOpen();
  const toolbar = captureToolbar({
    open,
    output: async () => undefined,
    act: async () => {},
    report: (message) => reports.push(message),
    now: () => clock,
  });
  return { toolbar, opened, reports, advance: (ms: number) => (clock += ms) };
}

test("a toolbar whose host goes before it drew is reported, and the next ⇧❖5 opens a new one", async () => {
  const { toolbar, opened, reports } = setup();
  toolbar();
  await settle();
  expect(opened).toHaveLength(1);
  opened[0]?.die();
  await settle();
  expect(reports).toEqual(["the capture toolbar's window went before it was ever drawn"]);
  toolbar();
  await settle();
  expect(opened).toHaveLength(2);
});

test("a press while the toolbar opens does nothing, and says so; a slow first frame is reported", async () => {
  const { toolbar, opened, reports, advance } = setup();
  toolbar();
  await settle();
  toolbar();
  expect(opened).toHaveLength(1);
  expect(reports).toEqual(["⇧❖5: the capture toolbar is still opening or at work; this press does nothing"]);
  advance(SLOW_DRAW_MS + 500);
  opened[0]?.frame();
  expect(reports.at(-1)).toBe(`the capture toolbar took ${SLOW_DRAW_MS + 500} ms to show`);
  // Closed from the toolbar (or by the shell): nothing more to say.
  toolbar.close();
  await settle();
  expect(reports).toHaveLength(2);
});

test("a toolbar that drew and was dismissed reports nothing", async () => {
  const { toolbar, opened, reports } = setup();
  toolbar();
  await settle();
  opened[0]?.frame();
  toolbar.close();
  await settle();
  expect(reports).toEqual([]);
});

test("Record while an agent records says so in the toolbar, which stays; a screenshot still goes", async () => {
  const elements: ReactElement[] = [];
  const closes: number[] = [];
  const acted: string[] = [];
  let state: RecorderState = { kind: "recording", since: 0, file: "/v/a.mp4", target: { kind: "screen", output: "Virtual-1" }, by: "agent" };
  const toolbar = captureToolbar({
    open: (_options, element, onClosed) => {
      elements.push(element);
      let exit: () => void = () => {};
      const exited = new Promise<void>((resolve) => {
        exit = resolve;
      });
      return {
        exited,
        close: () => {
          closes.push(elements.length);
          onClosed?.();
          exit();
        },
        scroll() {},
      };
    },
    output: async () => undefined,
    act: async (choice) => void acted.push(choice.mode),
    refuse: (choice) => recordRefusal(choice.mode, state),
    report: () => {},
  });
  toolbar();
  await settle();
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent: (l) => listeners.push(l), onClose() {}, simulate() {}, close() {} };
  const element = elements[0];
  if (!element) throw new Error("no toolbar");
  const root = render(element, transport);
  await settle(20);
  const press = async (testID: string) => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no ${testID}`);
    for (const listener of listeners) listener({ type: "press", nodeId: id });
    await settle(20);
  };
  await press("capture-toolbar:record-screen");
  await press("capture-toolbar:go");
  expect(trees.at(-1)).toContain("An agent is recording the screen");
  expect(closes).toEqual([]);
  // Another mode takes the words back; a screenshot needs no recorder, so it goes.
  await press("capture-toolbar:screen");
  expect(trees.at(-1)).not.toContain("An agent is recording the screen");
  await press("capture-toolbar:go");
  await settle();
  expect(closes).toEqual([1]);
  expect(acted).toEqual(["screen"]);
  root.unmount();
  // Once the agent's recording is over, Record records.
  state = { kind: "idle" };
  expect(recordRefusal("record-screen", state)).toBeNull();
  expect(recordRefusal("record-area", { kind: "starting", by: "agent" })).toBe("An agent is recording the screen");
  expect(recordRefusal("record-area", { kind: "saving", file: "/v/a.mp4", by: "person" })).toBe("The screen is already being recorded");
  expect(recordRefusal("window", { kind: "starting", by: "agent" })).toBeNull();
});
