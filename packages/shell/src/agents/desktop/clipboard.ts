/**
 * read_clipboard_history: the person's recent copies, after they say yes on
 * screen, every time (the scope is never kept either: consent.ts). What
 * Dashi left out of the history (password fields, password managers, copies
 * marked secret) was never kept, so it can't be read.
 */

import { json, type RunContext, type ToolResult, toolError } from "../context.ts";

export async function readClipboardHistory(limit: number, ctx: RunContext): Promise<ToolResult> {
  const clipboard = ctx.desktop.clipboard;
  if (!clipboard) return toolError("Clipboard history isn't kept in this session.");
  const copies = clipboard.recent(limit);
  if (copies.length === 0) return json({ copies: [] });
  ctx.status("Asking to see your clipboard history");
  const yes = await ctx.confirm({
    summary: copies.length === 1 ? "see your last copy" : `see your last ${copies.length} copies`,
    detail:
      "What you copied in Dashi's clipboard history: text, and what pictures and files were. Copies Dashi left out (password fields, password managers) aren't in it.",
    action: "Show Copies",
  });
  if (!yes) return toolError("The person did not allow it. Don't ask again unless they agree.");
  ctx.status("Reading your clipboard history");
  return json({ copies });
}
