/**
 * What the buttons say. For one app or applet: is it installed, does it have
 * an update, is something being done to it right now; and the state chip
 * every row, card and page shows for it (Get, Open, Update, "Installing
 * 40%"). Pure, so the window and its tests agree.
 */

import type { FlatpakUpdate, InstalledApp } from "../../src/software/flatpak-parse.ts";
import type { Progress } from "../../src/software/manager.ts";

export type OperationKind = "install" | "remove" | "update" | "system-update";

export interface Operation {
  /** `install:org.x.Y`, `applet:install:dev.x.y`: one at a time per key. */
  key: string;
  kind: OperationKind;
  /** The app's or applet's id (none for a system update or "update all"). */
  id?: string;
  /** An applet's change, not a Flatpak app's (their ids may look alike). */
  subject?: "applet";
  name: string;
  status: "queued" | "running";
  progress: Progress | null;
}

export type AppState =
  | { kind: "get" }
  | { kind: "open"; installed: InstalledApp }
  | { kind: "update"; installed: InstalledApp; update: FlatpakUpdate }
  | { kind: "busy"; operation: Operation };

/** The operation touching app `id` now, if any: an install, remove, or update of that app (or an "update all" that covers it). */
export function operationFor(operations: readonly Operation[], id: string, covered: ReadonlySet<string> = new Set()): Operation | undefined {
  const apps = operations.filter((operation) => operation.subject !== "applet");
  return (
    apps.find((operation) => operation.id === id) ?? apps.find((operation) => operation.kind === "update" && operation.id === undefined && covered.has(id))
  );
}

/** The operation touching applet `id` now, if any. */
export const appletOperation = (operations: readonly Operation[], id: string): Operation | undefined =>
  operations.find((operation) => operation.subject === "applet" && operation.id === id);

export function appState(id: string, installed: readonly InstalledApp[], updates: readonly FlatpakUpdate[], operations: readonly Operation[]): AppState {
  const covered = new Set(updates.map((update) => update.id));
  const operation = operationFor(operations, id, covered);
  if (operation) return { kind: "busy", operation };
  const have = installed.find((app) => app.id === id);
  if (!have) return { kind: "get" };
  const update = updates.find((each) => each.id === id && each.installation === have.installation);
  return update ? { kind: "update", installed: have, update } : { kind: "open", installed: have };
}

/** A key that changes exactly when what an `AppState` shows changes: a card re-renders on its own app's ticks, not everyone's. */
export function appStateKey(state: AppState): string {
  switch (state.kind) {
    case "get":
      return "get";
    case "open":
      return `open:${state.installed.installation}:${state.installed.version ?? ""}`;
    case "update":
      return `update:${state.installed.installation}:${state.update.version ?? ""}`;
    case "busy": {
      const { operation } = state;
      return `busy:${operation.key}:${operation.status}:${operation.progress?.fraction ?? ""}`;
    }
  }
}

const VERBS: Record<OperationKind, string> = { install: "Installing", remove: "Removing", update: "Updating", "system-update": "Updating" };

/** "Installing 42%", "Waiting": what a busy app shows in a small space; with `name`, "Installing VLC 42%". */
export function busyLabel(operation: Pick<Operation, "kind" | "status" | "progress">, name?: string): string {
  if (operation.status === "queued") return "Waiting";
  const verb = name === undefined ? VERBS[operation.kind] : `${VERBS[operation.kind]} ${name}`;
  const fraction = operation.progress?.fraction;
  return fraction === null || fraction === undefined ? `${verb}…` : `${verb} ${Math.round(fraction * 100)}%`;
}

/**
 * The state chip on a row, a card, or a page: one word for one action. Get
 * and Update wear "…" when a sheet comes first (broad access, new
 * permissions); an installed applet is plain words, not a button; a busy
 * one shows its progress with a way to stop it.
 */
export type Chip =
  | { kind: "get"; asks: boolean }
  | { kind: "open" }
  | { kind: "update"; asks: boolean }
  | { kind: "installed" }
  | { kind: "unavailable"; detail: string }
  | { kind: "busy"; operation: Operation };

/** The chip's words. */
export function chipLabel(chip: Chip): string {
  switch (chip.kind) {
    case "get":
      return chip.asks ? "Get…" : "Get";
    case "open":
      return "Open";
    case "update":
      return chip.asks ? "Update…" : "Update";
    case "installed":
      return "Installed";
    case "unavailable":
      return chip.detail;
    case "busy":
      return busyLabel(chip.operation);
  }
}

/** An app's chip from its state; `asks`: getting it shows the trust card as a sheet first. */
export function appChip(state: AppState, asks = false): Chip {
  if (state.kind === "busy") return { kind: "busy", operation: state.operation };
  if (state.kind === "get") return { kind: "get", asks };
  return state.kind === "open" ? { kind: "open" } : { kind: "update", asks: false };
}

/** Where an app is installed, in words. */
export const whereInstalled = (app: InstalledApp): string => (app.installation === "user" ? "Installed for you" : "Installed for everyone");

/**
 * "Installing VLC 42% · 2 waiting": the queue in one line, for the toolbar;
 * null when it is empty. `short`, for a narrow toolbar: "Installing 42%",
 * the name and the waiting count given up first (the rows still say them),
 * so the progress keeps its room.
 */
export function queueLine(operations: readonly Operation[], { short = false }: { short?: boolean } = {}): string | null {
  const running = operations.find((operation) => operation.status === "running");
  const waiting = operations.filter((operation) => operation.status === "queued").length;
  if (!running && waiting === 0) return null;
  const head = running ? busyLabel(running, short ? undefined : running.kind === "system-update" ? "the system" : running.name) : null;
  const tail = waiting > 0 ? `${waiting} waiting` : null;
  if (short) return head ?? tail;
  return [head, tail].filter((part): part is string => part !== null).join(" · ");
}
