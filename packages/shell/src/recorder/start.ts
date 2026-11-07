/**
 * The recorder and the ⇧❖5 toolbar put together for the shell: what each of
 * the toolbar's choices does, the area selection for recording (⇧❖4's
 * overlay, recording instead of capturing), and the notice when a recording
 * is saved (clicking it opens the file).
 */

import { basename } from "node:path";
import type { Compositor } from "../compositor.ts";
import type { NotificationStore } from "../notifications/index.ts";
import { SHELL_SENDER } from "../notifications/store.ts";
import type { OpenOverlay } from "../overlay.tsx";
import { type AreaCapture, areaCapture, type CaptureScreen } from "../screenshot-area.tsx";
import { takeScreenshot } from "../screenshots.ts";
import { type RecorderState, ScreenRecorder } from "./recorder.ts";
import { type CaptureToolbar, captureToolbar } from "./toolbar.tsx";

export interface CaptureDeps {
  compositor: Pick<Compositor, "request" | "windows">;
  open: OpenOverlay;
  /** Let a program capture the screen for a while (screen-capture.ts). */
  allow(path: string): () => void;
  notifications: Pick<NotificationStore, "notify" | "onEvent">;
  /** The screen holding `window` (else the primary), for the toolbar and the selection overlay. */
  screen(window: number | null): Promise<CaptureScreen>;
  /** ⇧❖4: select an area to capture (screenshot-area.tsx). */
  captureArea(window: number | null): void;
}

export interface Capture {
  recorder: ScreenRecorder;
  /** ⇧❖5 (and Screenshot…): the toolbar, or stop the recording the person started. */
  toolbar(window: number | null): void;
  close(): void;
}

function savedNotice(file: string) {
  return {
    appName: "Screen Recording",
    appIcon: "",
    summary: "Screen Recording Saved",
    body: `${basename(file)} is in Videos, Screen Recordings.`,
    actions: [{ key: "default", label: "Open" }],
    urgency: "normal" as const,
    expireTimeout: -1,
    imagePath: "",
    desktopEntry: "",
    category: "transfer.complete",
    transient: false,
    resident: false,
  };
}

/** What the toolbar says when Record is pressed while another recording runs (an agent's: the person's own is stopped by ⇧❖5). */
export function recordRefusal(mode: string, state: RecorderState): string | null {
  if (mode !== "record-screen" && mode !== "record-area") return null;
  if (state.kind === "idle") return null;
  return (state.kind === "recording" || state.kind === "starting") && state.by === "agent" ? "An agent is recording the screen" : "The screen is already being recorded";
}

/** Whether ⇧❖5 stops the recording now instead of opening the toolbar: the person's own is running. */
export function stopsRecording(state: RecorderState): boolean {
  return state.kind === "recording" && state.by === "person";
}

export function startCapture(deps: CaptureDeps): Capture {
  const opened = new Map<number, string>();
  const recorder = new ScreenRecorder({
    allow: deps.allow,
    saved: (file) => {
      opened.set(deps.notifications.notify(savedNotice(file), 0, SHELL_SENDER), file);
    },
    failed: (message) => console.error(`dashi-shell: ${message}`),
  });
  const stopListening = deps.notifications.onEvent((event) => {
    if (event.type !== "action") return;
    const file = opened.get(event.id);
    if (file) Bun.spawn(["gio", "open", file], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  });

  let front: number | null = null;
  let microphone = false;
  const fail = (error: unknown) => console.error("dashi-shell: screen recording:", error instanceof Error ? error.message : error);
  // Recording an area: ⇧❖4's overlay, recording what it selects (Space: the front window's frame).
  const recordArea: AreaCapture = areaCapture({
    open: deps.open,
    screen: () => deps.screen(front),
    captureArea: (rect) => recorder.start({ kind: "area", ...rect }, { microphone }).catch(fail),
    captureWindow: async () => {
      const frame = (await deps.compositor.windows()).find((window) => window.id === front)?.frame;
      if (frame) await recorder.start({ kind: "area", ...frame }, { microphone }).catch(fail);
    },
  });
  const bar: CaptureToolbar = captureToolbar({
    open: deps.open,
    // Record while an agent records: said in the toolbar, which stays, instead of closing on nothing.
    refuse: (choice) => recordRefusal(choice.mode, recorder.getSnapshot()),
    output: async () => (await deps.screen(front)).output,
    act: async (choice, output) => {
      switch (choice.mode) {
        case "screen":
          await takeScreenshot(deps.compositor);
          return;
        case "window":
          if (front !== null) await takeScreenshot(deps.compositor, { window: front });
          return;
        case "area":
          deps.captureArea(front);
          return;
        case "record-screen":
          if (output) await recorder.start({ kind: "screen", output }, { microphone: choice.microphone }).catch(fail);
          return;
        case "record-area":
          microphone = choice.microphone;
          recordArea();
          return;
      }
    },
  });

  return {
    recorder,
    toolbar(window) {
      // Only the person's own recording: an agent's record_screen runs on, and the toolbar opens as ever
      // (the menu bar's stop button still ends an agent's).
      if (stopsRecording(recorder.getSnapshot())) {
        void recorder.stop();
        return;
      }
      front = window;
      bar();
    },
    close() {
      bar.close();
      recordArea.close();
      recorder.close();
      stopListening();
    },
  };
}
