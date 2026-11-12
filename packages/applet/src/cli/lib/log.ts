/**
 * `dashi-applet dev`'s message log: each line between the applet and the
 * shell, in a few words with the time.
 *
 *   18:40:01 ✓ connected (protocol 3)
 *   18:40:01 ✓ “Weather” in the menu bar (dev)
 *   18:40:02 select refresh
 *   18:40:09 popover open 280×190
 *   18:40:12 run city #4 for “lis”
 *   18:40:12 #4 → 1 rows
 */

import { isRecord } from "@dashi/shape";

const time = (now: Date): string => now.toTimeString().slice(0, 8);

type Fields = Record<string, unknown>;

function fieldsOf(line: string): Fields | null {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export class MessageLog {
  private readonly shown = new Set<string>();

  /** A message from the applet ("out") or the shell ("in") → the log's line, or null for one not worth a line. */
  describe(direction: "in" | "out", line: string, now = new Date()): string | null {
    const fields = fieldsOf(line);
    if (!fields) return null;
    const text = direction === "in" ? this.fromShell(fields) : this.fromApplet(fields);
    return text === null ? null : `${time(now)} ${text}`;
  }

  private fromShell(fields: Fields): string | null {
    switch (fields.type) {
      case "welcome":
        return `✓ connected (protocol ${String(fields.protocol)})`;
      case "activate":
        return `activate at ${String(fields.x)},${String(fields.y)}`;
      case "select":
        return `select ${String(fields.item)}`;
      case "popover":
        return `popover open ${String(fields.width)}×${String(fields.height)} at ${String(fields.x)},${String(fields.y)}${fields.output ? ` on ${String(fields.output)}` : ""}`;
      case "dismiss":
        return fields.seq === undefined ? "popover dismissed by the shell" : `view ${String(fields.seq)} dismissed by the launcher`;
      case "run":
        return `run ${String(fields.command)} #${String(fields.seq)}${typeof fields.query === "string" ? ` for “${fields.query}”` : ""}${typeof fields.item === "string" ? ` chose ${fields.item}` : ""}`;
      case "view":
        return `view ${String(fields.seq)} open ${String(fields.width)}×${String(fields.height)} at ${String(fields.x)},${String(fields.y)}`;
      case "power":
        return `power mode ${String(fields.choice)}${typeof fields.mode === "string" ? ` (${String(fields.why ?? fields.mode)})` : ""}`;
      case "error":
        return `✗ refused: ${String(fields.message)}`;
      default:
        return null;
    }
  }

  private fromApplet(fields: Fields): string | null {
    switch (fields.type) {
      case "hello": {
        const manifest: Fields = isRecord(fields.manifest) ? fields.manifest : {};
        return `hello as ${String(manifest.id)} ${String(manifest.version)}`;
      }
      case "applet": {
        const applet: Fields = isRecord(fields.applet) ? fields.applet : {};
        const id = String(applet.id);
        if (!this.shown.has(id)) {
          this.shown.add(id);
          return `✓ “${String(applet.title)}” in the menu bar (dev)`;
        }
        return applet.label === undefined ? `applet ${id} changed` : `applet ${id}: ${String(applet.label)}`;
      }
      case "remove":
        this.shown.delete(String(fields.id));
        return `removed ${String(fields.id)}`;
      case "popover":
        return `popover asked ${String(fields.width)}×${String(fields.height)}`;
      case "dismiss":
        return fields.seq === undefined ? "popover closed" : `view ${String(fields.seq)} closed`;
      case "result": {
        const kind = ["text", "copy", "open", "error"].find((key) => fields[key] !== undefined) ?? "result";
        return `#${String(fields.seq)} ${kind === "error" ? "✗" : "→"} ${kind}: ${String(fields[kind]).slice(0, 60)}`;
      }
      case "items":
        return `#${String(fields.seq)} → ${Array.isArray(fields.rows) ? fields.rows.length : 0} rows`;
      case "view":
        return `#${String(fields.seq)} view asked ${String(fields.height)} tall`;
      case "power":
        return `asked for power mode ${String(fields.choice)}`;
      default:
        return null;
    }
  }
}
