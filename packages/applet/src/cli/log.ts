/**
 * `dashi-applet dev`'s message log: each line between the applet and the
 * shell, in a few words with the time.
 *
 *   18:40:01 ✓ connected (protocol 2)
 *   18:40:01 ✓ “Weather” in the menu bar (dev)
 *   18:40:02 select refresh
 *   18:40:09 popover open 280×190
 */

const time = (now: Date): string => now.toTimeString().slice(0, 8);

type Fields = Record<string, unknown>;

function fieldsOf(line: string): Fields | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
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
        return "popover dismissed by the shell";
      case "error":
        return `✗ refused: ${String(fields.message)}`;
      default:
        return null;
    }
  }

  private fromApplet(fields: Fields): string | null {
    switch (fields.type) {
      case "hello": {
        const manifest = (fields.manifest ?? {}) as Fields;
        return `hello as ${String(manifest.id)} ${String(manifest.version)}`;
      }
      case "applet": {
        const applet = (fields.applet ?? {}) as Fields;
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
        return "popover closed";
      default:
        return null;
    }
  }
}
