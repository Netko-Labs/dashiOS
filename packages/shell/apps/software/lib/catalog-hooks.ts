/** The catalog on this computer, as the views read it: the whole of it, one row, and the state of a row's button. */

import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { useEffect, useSyncExternalStore } from "react";
import { spawnDetached } from "../../../src/shared/apps/index.ts";
import type { CatalogData, CatalogEntry, Offer } from "../../../src/shared/software/index.ts";
import { useSelected } from "./hooks.ts";
import { type AppState, appState, appStateKey, type Operation, packageOperation } from "./model.ts";
import { useServices } from "./services.ts";

/** The catalog, read once when the window opens and again after every change; null until the first read. */
export function useCatalog(): CatalogData | null {
  const { index } = useServices();
  useEffect(() => {
    if (index.snapshot() === null) void index.load();
  }, [index]);
  return useSyncExternalStore(index.subscribe, index.snapshot);
}

/** One row of the catalog by its key. */
export function useEntry(key: string): CatalogEntry | null {
  const data = useCatalog();
  return data?.entries.find((entry) => entry.key === key) ?? null;
}

/** A package's button: busy with a change, installed (Open, Remove…), or Get. */
export type PackageState = { kind: "busy"; operation: Operation } | { kind: "installed" } | { kind: "get" };

export function packageState(offer: Offer, operations: readonly Operation[]): PackageState {
  const operation = packageOperation(operations, offer.ref);
  if (operation) return { kind: "busy", operation };
  return offer.installed ? { kind: "installed" } : { kind: "get" };
}

const packageKey = (state: PackageState): string =>
  state.kind === "busy" ? `busy:${state.operation.key}:${state.operation.progress?.fraction ?? ""}` : state.kind;

/** The button state of one source of a row: a Flatpak's as Flathub's apps have it, a package's from the catalog and the queue. */
export function useOfferState(offer: Offer | undefined): { flatpak: AppState | null; rpm: PackageState | null } {
  const { store } = useServices();
  const select = useSelected(
    store,
    (state) =>
      offer === undefined
        ? { flatpak: null, rpm: null }
        : offer.kind === "flatpak"
          ? { flatpak: appState(offer.ref, state.installed ?? [], state.appUpdates ?? [], state.operations), rpm: null }
          : { flatpak: null, rpm: packageState(offer, state.operations) },
    (value) => (value.flatpak ? appStateKey(value.flatpak) : value.rpm ? packageKey(value.rpm) : "none"),
  );
  return select;
}

const APPLICATIONS = (): string[] => [join(homedir(), ".local/share/applications"), "/usr/local/share/applications", "/usr/share/applications"];

/** Starts an app a package installed, from its desktop file (`gio launch`); false when there is none. */
export function openDesktop(desktopId: string, dirs: readonly string[] = APPLICATIONS(), launch = spawnDetached): boolean {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(desktopId)) return false;
  for (const dir of dirs) {
    try {
      if (readdirSync(dir).includes(`${desktopId}.desktop`)) {
        launch(["gio", "launch", join(dir, `${desktopId}.desktop`)]);
        return true;
      }
    } catch {
      // No such folder.
    }
  }
  return false;
}
