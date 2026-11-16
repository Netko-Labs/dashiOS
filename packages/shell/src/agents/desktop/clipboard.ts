/**
 * read_clipboard_history: the person's recent copies, after they say yes on
 * screen, every time (the scope is never kept either: consent.ts). What
 * Dashi left out of the history (password fields, password managers, copies
 * marked secret) was never kept, so it can't be read.
 */

import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";

/** copy_to_clipboard: the text on the clipboard, kept in the history as Dashi's. */
export async function copyToClipboard(value: string, ctx: RunContext): Promise<ToolResult> {
  const put = ctx.desktop.clipboard?.put;
  if (!put) return toolError("The clipboard can't be written in this session.");
  ctx.status("Copying to the clipboard");
  if (!(await put(value, "Dashi"))) return toolError("Nothing could write the clipboard (wl-copy is missing).");
  return text(`It is on the clipboard (${value.length} characters): the person can paste it.`, { copied: value.length });
}

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
