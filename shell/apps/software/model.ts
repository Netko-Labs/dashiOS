/**
 * What the buttons say. For one app: is it installed, does it have an update,
 * is something being done to it right now. Pure, so the window and its tests
 * agree.
 */

import type { FlatpakUpdate, InstalledApp } from "../../src/software/flatpak-parse.ts";
import type { Progress } from "../../src/software/manager.ts";

export type OperationKind = "install" | "remove" | "update" | "system-update";

export interface Operation {
  /** `install:org.x.Y`: one at a time per key. */
  key: string;
  kind: OperationKind;
  /** The app's id (none for a system update or "update all"). */
  id?: string;
  name: string;
  status: "queued" | "running";
  progress: Progress | null;
}

export type AppState =
  | { kind: "get" }
  | { kind: "open"; installed: InstalledApp }
  | { kind: "update"; installed: InstalledApp; update: FlatpakUpdate }
  | { kind: "busy"; operation: Operation };

/** The operation touching `id` now, if any: an install, remove, or update of that app (or an "update all" that covers it). */
export function operationFor(operations: readonly Operation[], id: string, covered: ReadonlySet<string> = new Set()): Operation | undefined {
  return operations.find((operation) => operation.id === id) ?? operations.find((operation) => operation.kind === "update" && operation.id === undefined && covered.has(id));
}

export function appState(id: string, installed: readonly InstalledApp[], updates: readonly FlatpakUpdate[], operations: readonly Operation[]): AppState {
  const covered = new Set(updates.map((update) => update.id));
  const operation = operationFor(operations, id, covered);
  if (operation) return { kind: "busy", operation };
  const have = installed.find((app) => app.id === id);
  if (!have) return { kind: "get" };
  const update = updates.find((each) => each.id === id && each.installation === have.installation);
  return update ? { kind: "update", installed: have, update } : { kind: "open", installed: have };
}

/** "Installing 42%", "Waiting…": what a busy app shows in a small space. */
export function busyLabel(operation: Operation): string {
  if (operation.status === "queued") return "Waiting";
  const verb = { install: "Installing", remove: "Removing", update: "Updating", "system-update": "Updating" }[operation.kind];
  const fraction = operation.progress?.fraction;
  return fraction === null || fraction === undefined ? `${verb}…` : `${verb} ${Math.round(fraction * 100)}%`;
}

/** Where an app is installed, in words. */
export const whereInstalled = (app: InstalledApp): string => (app.installation === "user" ? "Installed for you" : "Installed for everyone");
