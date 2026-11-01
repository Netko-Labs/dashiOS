/**
 * What the authentication sheet shows, as a store the sheet subscribes to,
 * and the three things the sheet can tell the agent. The agent
 * (controller.ts) owns the state; the sheet only draws it and reports clicks.
 */

import { useSyncExternalStore } from "react";
import { type AuthRequest, plainText } from "./request.ts";

export interface SheetUser {
  uid: number;
  login: string;
  /** Full name when known. */
  label: string;
}

/** One line of the sheet's "Details": a label and polkitd's value for it. */
export interface DetailRow {
  label: string;
  value: string;
}

/** Rows shown, and the longest value of one; polkitd's `details` is the caller's own text and can be long. */
export const MAX_DETAIL_ROWS = 6;
export const MAX_DETAIL_VALUE = 120;

/** What polkitd names in `details`, in the order worth reading, with friendlier labels. */
const KNOWN_DETAILS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["program", "Program"],
  ["command_line", "Command"],
];

/**
 * The rows for "Details": the action first, then the program and command line
 * polkit's own helpers (pkexec) pass along, then whatever else the action
 * names. `polkit.*` keys are polkit's bookkeeping (gettext domain, message
 * templates), not facts about the request, and are left out.
 */
export function detailRows(request: Pick<AuthRequest, "actionId" | "details">): DetailRow[] {
  const rows: DetailRow[] = [{ label: "Action", value: request.actionId }];
  const known = new Set(KNOWN_DETAILS.map(([key]) => key));
  for (const [key, label] of KNOWN_DETAILS) {
    const value = request.details.get(key);
    if (value !== undefined) rows.push({ label, value });
  }
  const others = [...request.details.keys()].filter((key) => !known.has(key) && !key.startsWith("polkit.")).sort();
  for (const key of others) rows.push({ label: plainText(key, 40), value: request.details.get(key) ?? "" });
  return rows
    .map(({ label, value }) => ({ label, value: plainText(value, MAX_DETAIL_VALUE) }))
    .filter((row) => row.value !== "")
    .slice(0, MAX_DETAIL_ROWS);
}

/** `starting`: the helper is not asking yet. `prompt`: waiting for an answer. `checking`: the answer is being verified. */
export type SheetPhase = "starting" | "prompt" | "checking";

export interface SheetState {
  /** What the action wants to do; polkitd's own words. */
  message: string;
  /** A path to the app's icon, when the request named one we can find. */
  icon: string | null;
  users: readonly SheetUser[];
  /** The uid being authenticated as. */
  user: number;
  phase: SheetPhase;
  /** What PAM is asking for ("Password"). */
  prompt: string;
  /** True when the answer may be shown as typed (a one-time code), false for a password. */
  echo: boolean;
  /** The request's facts, for the collapsed "Details" row; never empty (the action is always there). */
  details: readonly DetailRow[];
  /** Whether "Details" is open. */
  detailsOpen: boolean;
  /** Something to tell the person: PAM's own words, or "Sorry, try again.". */
  notice: { kind: "info" | "error"; text: string } | null;
}

export interface SheetActions {
  /** The person answered the prompt. */
  submit(password: string): void;
  /** Cancel, Esc, or the sheet going away. */
  cancel(): void;
  /** Authenticate as another of the offered users. */
  pick(uid: number): void;
  /** Open or close "Details". */
  toggleDetails(): void;
}

export class SheetStore {
  private snapshot: SheetState;
  private readonly listeners = new Set<() => void>();

  constructor(initial: SheetState) {
    this.snapshot = initial;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SheetState => this.snapshot;

  set(change: Partial<SheetState>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
}

export function useSheet(store: SheetStore): SheetState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** The asking line under the message. */
export const HINT = "Enter your password to allow this.";
export const RETRY = "Sorry, try again.";
