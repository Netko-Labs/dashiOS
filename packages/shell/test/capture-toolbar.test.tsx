/**
 * ⇧❖5's toolbar says when it didn't show: a host that went before drawing,
 * one slow to draw, and a press while one is still opening (which does
 * nothing). 15-nits step 7: the first ⇧❖5 during an agent's recording
 * seemed to open nothing, and nothing said why.
 */

import { expect, test } from "bun:test";
import type { NativeEvent, NativeHostTransport } from "@mirinjs/metal";
import type { OpenOverlay } from "../src/overlay.tsx";
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
