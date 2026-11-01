/**
 * Outputs from `wpctl status`, for a machine without `pw-dump`. That text is
 * written for people, so only the Audio section's Sinks list is read: one line
 * per sink, `*` marking the default, a `[vol: …]` note at the end that is not
 * part of the name. Lines that do not fit are skipped; a text with no Audio
 * section at all is not a status listing (null).
 */

import { outputKind } from "./kind.ts";
import type { Side } from "./parse-dump.ts";
import type { Output } from "./types.ts";

/** Colour codes, in case the listing was not piped. */
const ESCAPE = /\u001b\[[0-9;]*[A-Za-z]/g;
/** A tree header such as ` ├─ Sinks:`. */
const SECTION = /^[\s│]*[├└]─ (.+):\s*$/;
/** A sink line such as `│  *   58. Example Laptop Speakers   [vol: 0.40]`. */
const SINK = /^[\s│]*(\*)?\s*(\d+)\.\s+(.+?)\s*$/;
const VOLUME_NOTE = /\s*\[vol:[^\]]*\]$/;

export function parseStatus(text: string, side: Side = "output"): Output[] | null {
  const wanted = side === "output" ? "Sinks" : "Sources";
  let inAudio = false;
  let found = false;
  let section: string | undefined;
  const sinks: Output[] = [];
  for (const line of text.replace(ESCAPE, "").split("\n")) {
    // Top-level headings (PipeWire, Audio, Video, Settings) start at column zero.
    if (/^\S/.test(line)) {
      inAudio = line.trim() === "Audio";
      found ||= inAudio;
      section = undefined;
      continue;
    }
    if (!inAudio) continue;
    const header = SECTION.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    if (section !== wanted) continue;
    const match = SINK.exec(line);
    if (!match?.[2] || !match[3]) continue;
    const id = Number(match[2]);
    const label = match[3].replace(VOLUME_NOTE, "").trim();
    if (!Number.isSafeInteger(id) || label === "") continue;
    sinks.push({ id, label, current: match[1] === "*", kind: outputKind({ label }) });
  }
  return found ? sinks : null;
}
