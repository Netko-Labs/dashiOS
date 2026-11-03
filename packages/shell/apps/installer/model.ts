/**
 * The Installer's pages and what they hold, as pure functions: which page
 * follows which, what an account needs, and where an install is by the
 * events dashi-install sends (helper.ts).
 */

import { type InstallEvent, STEPS, type Step } from "./helper.ts";

/** The pages people move through with Back and Continue, then the install's own. */
export const FORM_PAGES = ["welcome", "disk", "account", "options", "confirm"] as const;
export type FormPage = (typeof FORM_PAGES)[number];
export type Page = FormPage | "installing" | "done" | "failed";

export function nextPage(page: FormPage): Page {
  const at = FORM_PAGES.indexOf(page);
  return at === FORM_PAGES.length - 1 ? "installing" : (FORM_PAGES[at + 1] ?? "installing");
}

export function previousPage(page: FormPage): FormPage {
  return FORM_PAGES[Math.max(0, FORM_PAGES.indexOf(page) - 1)] ?? "welcome";
}

export interface Account {
  fullName: string;
  user: string;
  password: string;
  confirm: string;
  hostname: string;
}

export const MIN_PASSWORD = 6;

/** An account name from a full name: its first word, lowercase, accents and anything else dropped ("Juan Castañeda" → "juan"). */
export function suggestUser(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  const plain = first
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  const name = plain.replace(/^[^a-z_]+/, "").slice(0, 32);
  return name;
}

/** The computer's name from the account's ("juan" → "juan-dashi"), as dashi-install takes one. */
export function suggestHostname(user: string): string {
  return user ? `${user}-dashi`.replace(/[^A-Za-z0-9-]/g, "").slice(0, 63) : "dashi";
}

/** What is wrong with the account, in words for the page, or null when it is ready. */
export function accountProblem(account: Account): string | null {
  if (!account.fullName.trim()) return "Enter your name.";
  if (account.fullName.includes(":")) return "A name can't contain a colon.";
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(account.user)) return "The account name is lowercase letters, digits, - or _, starting with a letter.";
  if (["root", "liveuser", "bin", "daemon", "nobody"].includes(account.user)) return "That account name is taken by the system.";
  if (account.password.length < MIN_PASSWORD) return `The password needs at least ${MIN_PASSWORD} characters.`;
  if (account.password !== account.confirm) return "The passwords don't match.";
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(account.hostname)) return "The computer's name is letters, digits, and -.";
  return null;
}

export const STEP_LABELS: Record<Step, string> = {
  check: "Checking the disk",
  partition: "Preparing the disk",
  copy: "Copying Dashi",
  configure: "Setting up the system",
  account: "Creating your account",
  bootloader: "Making it start",
  finish: "Drivers and the kernel",
};

export interface Progress {
  /** The step running, or null before the first. */
  step: Step | null;
  /** The steps done, in order. */
  done: Step[];
  /** How far the copy is (0 to 1), while copying. */
  fraction: number | null;
  failed: { step: Step; message: string } | null;
  /** The helper finished: true installed, false not. */
  ok: boolean | null;
}

export const START: Progress = { step: null, done: [], fraction: null, failed: null, ok: null };

/** The progress after `event`. */
export function advance(progress: Progress, event: InstallEvent): Progress {
  switch (event.event) {
    case "step": {
      const done = progress.step && !progress.done.includes(progress.step) ? [...progress.done, progress.step] : progress.done;
      return { ...progress, step: event.step, done, fraction: null };
    }
    case "progress":
      return event.step === progress.step ? { ...progress, fraction: event.fraction } : progress;
    case "failed":
      return { ...progress, failed: { step: event.step, message: event.message } };
    case "finished": {
      const done = event.ok && progress.step && !progress.done.includes(progress.step) ? [...progress.done, progress.step] : progress.done;
      return { ...progress, done, ok: event.ok, fraction: null };
    }
  }
}

/** The whole install as one fraction: the copy is most of it. */
export function overall(progress: Progress): number {
  const weights: Record<Step, number> = { check: 1, partition: 3, copy: 70, configure: 3, account: 1, bootloader: 12, finish: 10 };
  const total = STEPS.reduce((sum, step) => sum + weights[step], 0);
  let reached = progress.done.reduce((sum, step) => sum + weights[step], 0);
  if (progress.step && !progress.done.includes(progress.step)) reached += weights[progress.step] * (progress.fraction ?? 0);
  return Math.min(1, reached / total);
}
