/** Hooks that load catalog pages and image files for the views. */

import { useCallback, useEffect, useRef, useState } from "react";
import { type Answer, CatalogError } from "../../src/software/flathub.ts";
import { useServices } from "./services.ts";

/** The file for an image URL: the cached one at once if there is one, else once it is downloaded; null until then or when it can't be had. */
export function useImage(url: string | null): string | null {
  const { images } = useServices();
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

export type Load<T> =
  | { status: "loading" }
  | { status: "ready"; value: T; stale: boolean }
  | { status: "failed"; offline: boolean; message: string };

/** Runs `load` when `key` changes (and on `reload`); late answers for an earlier key are dropped. */
export function useLoad<T>(key: string, load: () => Promise<Answer<T>>): { state: Load<T>; reload: () => void } {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [round, setRound] = useState(0);
  const loader = useRef(load);
  loader.current = load;
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
  return { state, reload: useCallback(() => setRound((n) => n + 1), []) };
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
