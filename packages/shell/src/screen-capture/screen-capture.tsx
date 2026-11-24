/**
 * The menu bar's privacy indicator: a red dot and "Screen is being shared"
 * for as long as the compositor reports a capture (screen-capture.ts), unless
 * it is Dashi's own recording, which shows its stop button instead.
 */

import { Chip } from "@dashi/ui";
import { useSyncExternalStore } from "react";
import type { ScreenRecorder } from "../recorder/index.ts";
import { type ScreenCaptureStore, useScreenCapture } from "./screen-capture.ts";

const IDLE = () => false;
const NEVER = () => () => {};

/** Whether `recorder` is recording, so the pill gives way to its stop button (recorder/indicator.tsx). */
function useRecording(recorder: ScreenRecorder | undefined): boolean {
  return useSyncExternalStore(recorder?.subscribe ?? NEVER, recorder ? () => recorder.ownsCapture() : IDLE);
}

/** The privacy indicator's red dot, as the chip's glyph. */
const DOT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.5" fill="#000"/></svg>`;

/** A status, never a control: the kit's Chip in ume, its dot before the words (UI-12). */
export function CapturePill({ store, recorder }: { store: ScreenCaptureStore; recorder?: ScreenRecorder }) {
  const capturing = useScreenCapture(store);
  const recording = useRecording(recorder);
  if (!capturing || recording) return null;
  return <Chip testID="capture-pill" tone="danger" glyph={DOT} label="Screen is being shared" />;
}
