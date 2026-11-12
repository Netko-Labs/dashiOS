/**
 * `Notify`'s arguments (`susssasa{sv}i`) as store input. The hints are a
 * dictionary of variants an app fills as it likes, so each one read is checked
 * for the type the spec gives it and ignored if it doesn't match.
 */

import type { Variant } from "../../shared/dbus/index.ts";
import { clean, LIMITS, plainBody } from "../text.ts";
import type { NotificationAction, NotifyInput, Urgency } from "../types.ts";

export interface NotifyCall {
  /** 0 for a new notification, else the one to replace. */
  replacesId: number;
  input: NotifyInput;
}

const URGENCIES: readonly Urgency[] = ["low", "normal", "critical"];

type Hints = ReadonlyMap<string, Variant>;

function hintString(hints: Hints, key: string): string {
  const hint = hints.get(key);
  return hint?.signature === "s" && typeof hint.value === "string" ? clean(hint.value, LIMITS.hint) : "";
}

function hintBoolean(hints: Hints, key: string): boolean {
  const hint = hints.get(key);
  return hint?.signature === "b" && hint.value === true;
}

/** The `urgency` hint is a byte; some clients send other integer types. */
function urgency(hints: Hints): Urgency {
  const hint = hints.get("urgency");
  const level = hint && "ynqiu".includes(hint.signature) && typeof hint.value === "number" ? hint.value : 1;
  return URGENCIES[level] ?? "normal";
}

/** Alternating keys and labels; a trailing key without a label is dropped. */
function actionList(flat: readonly unknown[]): NotificationAction[] {
  const actions: NotificationAction[] = [];
  for (let i = 0; i + 1 < flat.length && actions.length < LIMITS.actions; i += 2) {
    const key = clean(String(flat[i]), LIMITS.actionKey);
    if (key && !actions.some((action) => action.key === key)) {
      actions.push({ key, label: clean(String(flat[i + 1]), LIMITS.actionLabel) });
    }
  }
  return actions;
}

/** A `file://` URI as its path; anything else unchanged. */
export function uriToPath(value: string): string {
  if (!value.startsWith("file://")) return value;
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return "";
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const whole = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isInteger(value) ? value : fallback);
const NO_HINTS: Hints = new Map();

/** Notify's arguments (`susssasa{sv}i`). The bus checked the signature; each value is still read, never taken on its word. */
export function parseNotify(args: readonly unknown[]): NotifyCall {
  const appName = text(args[0]);
  const replacesId = whole(args[1], 0);
  const appIcon = text(args[2]);
  const summary = text(args[3]);
  const body = text(args[4]);
  const actions: readonly unknown[] = Array.isArray(args[5]) ? args[5] : [];
  const hints: Hints = args[6] instanceof Map ? args[6] : NO_HINTS;
  const expireTimeout = whole(args[7], -1);
  return {
    replacesId,
    input: {
      appName: clean(appName, LIMITS.appName),
      appIcon: clean(uriToPath(appIcon), LIMITS.hint),
      summary: clean(summary, LIMITS.summary),
      body: clean(plainBody(body), LIMITS.body),
      actions: actionList(actions),
      urgency: urgency(hints),
      expireTimeout,
      imagePath: uriToPath(hintString(hints, "image-path") || hintString(hints, "image_path")),
      desktopEntry: hintString(hints, "desktop-entry").replace(/\.desktop$/, ""),
      category: hintString(hints, "category"),
      transient: hintBoolean(hints, "transient"),
      resident: hintBoolean(hints, "resident"),
    },
  };
}
