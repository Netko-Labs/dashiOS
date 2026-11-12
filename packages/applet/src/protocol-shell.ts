/** The shell → applet direction of the applets channel (protocol.ts): each message the shell sends, and its commands. */

import { isRecord, maybe, nullable, num, obj, str } from "@dashi/shape";
import { isRefusal, typedObject } from "@dashi/shape/kit";
import { parseControlAction, parseShown } from "./controls.ts";
import { parsePowerState } from "./power.ts";
import type { AppletShellMessage } from "./protocol-types.ts";

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Where a popover or a view goes: a rect on a screen (null: the shell's choice), and its layer's namespace. */
const AREA = obj({ x: num(), y: num(), width: num(), height: num(), output: nullable(str()), namespace: str() }, { strict: false });

/** One line from the shell (the applet's side); null for anything else, so a newer shell's messages are skipped. */
export function parseAppletShellMessage(line: string): AppletShellMessage | null {
  const message = typedObject(line);
  if (isRefusal(message)) return null;
  const { type, fields } = message;
  if (type === "error") return typeof fields.message === "string" ? { type: "error", message: fields.message } : null;
  if (type === "welcome") return isNumber(fields.protocol) ? { type: "welcome", protocol: fields.protocol } : null;
  if (type === "power") {
    const state = parsePowerState(fields);
    return state ? { type: "power", ...state } : null;
  }
  if (type === "controls") {
    const shown = parseShown(fields);
    return shown ? { type: "controls", shown } : null;
  }
  if (type === "control-action") {
    const action = parseControlAction(fields);
    return action ? { type: "control-action", ...action } : null;
  }
  if (isNumber(fields.seq)) return parseRunMessage(type, fields, fields.seq);
  if (typeof fields.id !== "string") return null;
  if (type === "activate" && isNumber(fields.x) && isNumber(fields.y)) return { type: "activate", id: fields.id, x: fields.x, y: fields.y };
  if (type === "select" && typeof fields.item === "string") return { type: "select", id: fields.id, item: fields.item };
  if (type === "dismiss") return { type: "dismiss", id: fields.id };
  const popoverArea = type === "popover" ? maybe(AREA, fields) : null;
  if (popoverArea) {
    return {
      type: "popover",
      id: fields.id,
      x: popoverArea.x,
      y: popoverArea.y,
      width: popoverArea.width,
      height: popoverArea.height,
      output: popoverArea.output,
      namespace: popoverArea.namespace,
    };
  }
  return null;
}

/** A shell message as it goes on the wire: `dismiss-view` is `{"type":"dismiss","seq"}`. */
export function wireMessage(message: AppletShellMessage): Record<string, unknown> {
  return message.type === "dismiss-view" ? { type: "dismiss", seq: message.seq } : { ...message };
}

const isArgValue = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

/** The shell's version 3 messages, each about a command run. */
function parseRunMessage(type: string, fields: Record<string, unknown>, seq: number): AppletShellMessage | null {
  if (type === "dismiss") return { type: "dismiss-view", seq };
  if (type === "run") {
    if (typeof fields.command !== "string") return null;
    const args: Record<string, string | number | boolean> = {};
    for (const [name, value] of Object.entries(isRecord(fields.args) ? fields.args : {})) {
      if (!isArgValue(value)) return null;
      args[name] = value;
    }
    return {
      type: "run",
      seq,
      command: fields.command,
      args,
      ...(typeof fields.query === "string" ? { query: fields.query } : {}),
      ...(typeof fields.item === "string" ? { item: fields.item } : {}),
    };
  }
  const viewArea = type === "view" ? maybe(AREA, fields) : null;
  if (viewArea) {
    return {
      type: "view",
      seq,
      x: viewArea.x,
      y: viewArea.y,
      width: viewArea.width,
      height: viewArea.height,
      output: viewArea.output,
      namespace: viewArea.namespace,
    };
  }
  return null;
}
