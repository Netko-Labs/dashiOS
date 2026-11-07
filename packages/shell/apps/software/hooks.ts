/** Hooks the views share: catalog pages and image files loaded, one app's state picked out of the store, and the toolbar's "saved results" chip. */

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type Answer, CatalogError } from "../../src/software/flathub.ts";
import type { InstalledApp } from "../../src/software/flatpak-parse.ts";
import { findLocalIcon } from "./format.ts";
import { type AppState, appState, appStateKey } from "./model.ts";
import { useServices } from "./services.ts";
import type { SoftwareState, SoftwareStore } from "./store.ts";

/** The file for an image URL: the cached one at once if there is one, else once it is downloaded; null until then or when it can't be had. */
export function useImage(url: string | null, source: "flathub" | "applets" = "flathub"): string | null {
  const services = useServices();
  const images = source === "flathub" ? services.images : services.appletImages;
  const [file, setFile] = useState<string | null>(() => images.cached(url));
  useEffect(() => {
    let current = true;
    const have = images.cached(url);
    setFile(have);
    if (have === null && url !== null) {
      void images.file(url).then((path) => {
        if (current) setFile(path);
      });
    }
    return () => {
      current = false;
    };
  }, [images, url]);
  return file;
}

export type Load<T> = { status: "loading" } | { status: "ready"; value: T; stale: boolean } | { status: "failed"; offline: boolean; message: string };

/** Runs `load` when `key` changes (and on `reload`); late answers for an earlier key are dropped. */
export function useLoad<T>(key: string, load: () => Promise<Answer<T>>): { state: Load<T>; reload: () => void } {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [round, setRound] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` and `round` ask for a reload; the loader is a ref
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    loader
      .current()
      .then((answer) => current && setState({ status: "ready", value: answer.value, stale: answer.stale }))
      .catch((error: unknown) => {
        if (!current) return;
        const offline = error instanceof CatalogError && error.kind === "offline";
        setState({ status: "failed", offline, message: error instanceof Error ? error.message : "Something went wrong." });
      });
    return () => {
      current = false;
    };
    // `round` is the retry button; `key` names what is loaded.
  }, [key, round]);
  useReportStale(state.status === "ready" && state.stale);
  return { state, reload: useCallback(() => setRound((n) => n + 1), []) };
}

/**
 * A part of the store's state, re-rendering only when `key` of it changes: a
 * card follows its own app, so a progress tick re-renders one card, not the
 * whole grid.
 */
export function useSelected<T>(store: SoftwareStore, select: (state: SoftwareState) => T, key: (value: T) => string): T {
  const cache = useRef<{ key: string; value: T } | null>(null);
  const snapshot = (): T => {
    const value = select(store.getSnapshot());
    const now = key(value);
    if (cache.current?.key === now) return cache.current.value;
    cache.current = { key: now, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, snapshot);
}

/** The state of one app's button, live from the store, re-rendering only when it changes. */
export function useAppState(id: string): AppState {
  const { store } = useServices();
  return useSelected(store, (state) => appState(id, state.installed ?? [], state.appUpdates ?? [], state.operations), appStateKey);
}

/** The catalog's icon URL for an app (from its page, cached for hours), for installed apps that exported none; null until known. */
export function useCatalogIcon(id: string, wanted: boolean): string | null {
  const { catalog } = useServices();
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    catalog
      .details(id)
      .then((answer) => current && setIcon(answer.value.icon))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [catalog, id, wanted]);
  return icon;
}

/**
 * An installed app's icon: the file flatpak exported (found off the render
 * path), else the catalog's, asked for only when there is no file. A row on
 * Installed or Updates costs no network when the app has its own icon.
 */
export function useInstalledIcon(app: Pick<InstalledApp, "id" | "installation">): { file: string | null; url: string | null } {
  const { id, installation } = app;
  const [file, setFile] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    void findLocalIcon({ id, installation }).then((found) => current && setFile(found));
    return () => {
      current = false;
    };
  }, [id, installation]);
  const url = useCatalogIcon(id, file === null);
  return { file: file ?? null, url };
}

/** The name of an app, for a menu that acts on the app page open: the catalog's (cached for hours), else the id until it is known. */
export function useAppName(id: string | null): string | null {
  const { catalog } = useServices();
  const [named, setNamed] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (id === null) return;
    let current = true;
    catalog
      .details(id)
      .then((answer) => current && setNamed({ id, name: answer.value.name }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [catalog, id]);
  return id === null ? null : named?.id === id ? named.name : id;
}

/** Where pages say they show saved results (+1 while one does, −1 after); the window draws one chip in its toolbar while any does (VS-5). */
export const StaleContext = createContext<(delta: 1 | -1) => void>(() => {});

/** Tells the toolbar this part of the page is showing saved results, while `stale`. */
export function useReportStale(stale: boolean): void {
  const report = useContext(StaleContext);
  useEffect(() => {
    if (!stale) return;
    report(1);
    return () => report(-1);
  }, [report, stale]);
}
