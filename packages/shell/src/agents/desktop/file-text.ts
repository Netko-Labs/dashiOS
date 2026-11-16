/**
 * Carrying out read_text_file, write_text_file, move_file, copy_file and
 * rename_file (tools/lib/file-text.ts); the rules are shared/files/
 * agent-text.ts's and agent-moves.ts's. The status line names what is done,
 * never a file: names are the person's.
 */

import { moveForAgent, readTextForAgent, renameForAgent, writeTextForAgent } from "../../shared/files/index.ts";
import { type RunContext, type ToolResult, text, toolError } from "../context.ts";
import type { Call } from "../tools/index.ts";
import { currentPolicy } from "./files.ts";

type FileTextCall = Extract<Call, { name: "read_text_file" | "write_text_file" | "move_file" | "copy_file" | "rename_file" }>;

async function readText(call: Extract<Call, { name: "read_text_file" }>, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Reading a file");
  const read = await readTextForAgent(call.path, { from: call.from, count: call.count, maxChars: call.maxChars }, currentPolicy());
  if ("error" in read) return toolError(read.error);
  const what = read.kind === "pdf" ? "The PDF's text, lines" : "Lines";
  const more = read.next !== null ? ` For more: from_line ${read.next}.` : "";
  return text(`${what} ${read.from} to ${read.to} of ${read.lines}.${more}\n\n${read.text}`, {
    path: read.path,
    from: read.from,
    to: read.to,
    lines: read.lines,
    next: read.next,
  });
}

const trashedWords = (trashed: boolean): string => (trashed ? " The one that was there is in the Trash." : "");

export async function fileTextCall(call: FileTextCall, ctx: RunContext): Promise<ToolResult> {
  const policy = currentPolicy();
  switch (call.name) {
    case "read_text_file":
      return readText(call, ctx);
    case "write_text_file": {
      ctx.status("Writing a file");
      const done = await writeTextForAgent(call.path, call.text, call.mode, policy);
      if ("error" in done) return toolError(done.error);
      const how = call.mode === "append" ? "Added to" : done.created ? "Wrote the new file" : "Wrote";
      return text(`${how} ${done.path} (${done.bytes} bytes).${trashedWords(done.trashed)}`, { ...done });
    }
    case "move_file":
    case "copy_file": {
      ctx.status(call.name === "move_file" ? "Moving a file" : "Copying a file");
      const done = await moveForAgent(call.name === "move_file" ? "move" : "copy", call.path, call.to, call.replace, policy);
      if ("error" in done) return toolError(done.error);
      return text(`${call.name === "move_file" ? "Moved" : "Copied"} to ${done.to}.${trashedWords(done.trashed)}`, { ...done });
    }
    case "rename_file": {
      ctx.status("Renaming a file");
      const done = await renameForAgent(call.path, call.newName, call.replace, policy);
      if ("error" in done) return toolError(done.error);
      return text(`Renamed to ${done.to}.${trashedWords(done.trashed)}`, { ...done });
    }
  }
}
