/**
 * What Preview says about something that just happened, over the content's
 * foot (AppWindow's notice, VS-3): a failed action in ume until it is
 * dismissed (PA-6), a note that fades, and "Moved “x” to the Trash." with
 * Undo, which stays until it is dismissed, used or replaced. Never a sheet:
 * sheets are for questions. One at a time; a new one replaces the last.
 */

import { useEffect, useRef, useState } from "react";
import type { Say } from "../commands.ts";

/** How long a note without Undo stays (ms), as Files' (store-state.ts NOTICE_FADE_MS). */
export const NOTICE_FADE_MS = 5000;

export interface PreviewNotice {
  id: number;
  text: string;
  tone: "error" | "info";
  undo?: () => void;
}

export interface Notices {
  notice: PreviewNotice | null;
  say: Say;
  dismiss(): void;
}

export function useNotices(fadeMs: number = NOTICE_FADE_MS): Notices {
  const [notice, setNotice] = useState<PreviewNotice | null>(null);
  const next = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  // Its timer goes with the window.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const say: Say = (text, given, undo) => {
    stop();
    const tone = given ?? "error";
    const id = ++next.current;
    setNotice({ id, text, tone, ...(undo ? { undo } : {}) });
    if (tone === "info" && !undo) timer.current = setTimeout(() => setNotice((now) => (now?.id === id ? null : now)), fadeMs);
  };
  const dismiss = (): void => {
    stop();
    setNotice(null);
  };
  return { notice, say, dismiss };
}
