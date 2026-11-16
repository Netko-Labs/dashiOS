/**
 * What a view's components reach (docs/launcher-extensions.md, "Hooks"): its
 * preferences, its navigation, a line in the launcher's field row, and a
 * query that keeps its last answer while a new one comes.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PreferenceValue, ToastStyle } from "../view/wire.ts";

/** What views.ts gives each command's views. */
export interface ViewContextValue {
  preferences(): Readonly<Record<string, PreferenceValue>>;
  subscribe(listener: () => void): () => void;
  push(element: React.ReactNode): void;
  pop(): void;
  toast(style: ToastStyle, title: string): void;
  /** Done: the launcher closes. */
  close(): void;
}

const missing = (): never => {
  throw new Error("A launcher hook is used outside a command's view (defineApplet's commands, view/mode list, grid or detail)");
};

export const ViewContext = createContext<ViewContextValue>({
  preferences: missing,
  subscribe: missing,
  push: missing,
  pop: missing,
  toast: missing,
  close: missing,
});

/** The extension's preferences as the person set them (applet.json `preferences`); the view renders again when one changes. */
export function usePreferences<T extends Record<string, PreferenceValue | undefined> = Record<string, PreferenceValue | undefined>>(): T {
  const view = useContext(ViewContext);
  const values = useSyncExternalStore(view.subscribe, view.preferences);
  return values as T;
}

/** Show a view over this one (`push`), or go back (`pop`); Esc pops too. */
export function useNavigation(): { push(element: React.ReactNode): void; pop(): void } {
  const view = useContext(ViewContext);
  return { push: view.push, pop: view.pop };
}

/** A line in the launcher's field row ("Copied", "Couldn't reach GitHub"), and closing the launcher when done. */
export function useLauncher(): { toast(style: ToastStyle, title: string): void; close(): void } {
  const view = useContext(ViewContext);
  return { toast: view.toast, close: view.close };
}

export interface Query<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
  reload(): void;
}

const KEEP_MS = { "1m": 60_000, "5m": 300_000, "1h": 3_600_000 } as const;

/** Answers kept while the process runs, by the deps they were asked with (`keepAnswers`). */
export interface Kept<T> {
  readonly ms: number;
  readonly answers: Map<string, { at: number; data: T }>;
}

/**
 * Where a query keeps its last answers, made once outside the component: a command opened again within
 * `forMs` shows them at once while a new one comes (the process stays a minute after the launcher last used it).
 *
 *   const PRS = keepAnswers<PullRequest[]>("5m");
 *   const { data } = useQuery(() => myPullRequests(token), [token], { keep: PRS });
 */
export function keepAnswers<T>(forMs: keyof typeof KEEP_MS): Kept<T> {
  return { ms: KEEP_MS[forMs], answers: new Map() };
}

/** `fn`'s answer, asked again when `deps` change or on `reload`; with `keep`, the last answer for the same deps first. */
export function useQuery<T>(fn: () => Promise<T>, deps: readonly unknown[], options: { keep?: Kept<T> } = {}): Query<T> {
  const key = JSON.stringify(deps);
  const keep = options.keep;
  const cached = keep?.answers.get(key);
  const fresh = cached && keep && Date.now() - cached.at < keep.ms ? cached.data : undefined;
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: Error | undefined }>({ data: fresh, loading: true, error: undefined });
  const [round, setRound] = useState(0);
  const run = useRef(fn);
  run.current = fn;
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again when the caller's deps (as `key`) change, or on reload
  useEffect(() => {
    let current = true;
    setState((now) => ({ ...now, loading: true }));
    run.current().then(
      (data) => {
        keep?.answers.set(key, { at: Date.now(), data });
        if (current) setState({ data, loading: false, error: undefined });
      },
      (error: unknown) => {
        if (current) setState((now) => ({ data: now.data, loading: false, error: error instanceof Error ? error : new Error(String(error)) }));
      },
    );
    return () => {
      current = false;
    };
  }, [key, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { ...state, reload };
}
