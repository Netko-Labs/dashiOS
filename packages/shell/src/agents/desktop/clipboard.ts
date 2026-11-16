/**
 * read_clipboard_history: the person's recent copies. Not critical
 * (decisions.md D260): it runs without a sheet and the activity shows it. What
 * Dashi left out of the history (password fields, password managers, copies
 * marked secret) was never kept, so it can't be read.
 */

import { json, type RunContext, type ToolResult, toolError } from "../context.ts";

export async function readClipboardHistory(limit: number, ctx: RunContext): Promise<ToolResult> {
  const clipboard = ctx.desktop.clipboard;
  if (!clipboard) return toolError("Clipboard history isn't kept in this session.");
  const copies = clipboard.recent(limit);
  if (copies.length === 0) return json({ copies: [] });
  ctx.status("Reading your clipboard history");
  return json({ copies });
}
