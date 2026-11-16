/**
 * attach_file and list_downloads (tools/lib/transfer.ts) through Dashi's
 * extension. A file to attach is read here, under the same rules as
 * read_text_file (the person's roots, never a secret place), and goes to the
 * page in chunks: the portal's file chooser is never shown. A download's
 * path is the browser's.
 */

import { isRecord } from "@dashi/shape";
import { placeForAgent } from "../../shared/files/index.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";
import type { Call } from "../tools/index.ts";
import { isResult, linkFor, onPage } from "./browser.ts";
import { currentPolicy } from "./files.ts";

/** The biggest file attached; native messaging carries 1 MB a message, so it goes in chunks of this. */
export const ATTACH_MAX = 25 * 1024 * 1024;
const CHUNK = 512 * 1024;

export async function attachFile(call: Extract<Call, { name: "attach_file" }>, ctx: RunContext): Promise<ToolResult> {
  const place = await placeForAgent(call.path, currentPolicy());
  if (!place.ok) return toolError(place.error);
  if (!place.exists || place.kind !== "file") return toolError("There is no file at that path.");
  const file = Bun.file(place.path);
  if (file.size > ATTACH_MAX) return toolError(`The file is ${Math.round(file.size / 1048576)} MB; Dashi attaches files up to 25 MB.`);
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const name = place.path.slice(place.path.lastIndexOf("/") + 1);
  return onPage(ctx, call.tab, "Attaching a file on", async (link, tab) => {
    const id = crypto.randomUUID();
    const total = Math.max(1, Math.ceil(base64.length / CHUNK));
    let last: Record<string, unknown> = {};
    for (let index = 0; index < total; index++) {
      const chunk = base64.slice(index * CHUNK, (index + 1) * CHUNK);
      last = await link.ask("attach", { tab: tab.id, ref: call.ref, id, index, total, chunk, name, type: file.type.split(";")[0] ?? "" });
    }
    const accept = typeof last.accept === "string" ? ` The field asks for ${last.accept}.` : "";
    return text(
      `Attached “${name}” (${file.size} bytes) to [${call.ref}]; it holds ${String(last.files ?? 1)} file(s) now.${accept} Nothing is sent until the form is.`,
      {
        attached: name,
        bytes: file.size,
      },
    );
  });
}

export async function listDownloads(call: Extract<Call, { name: "list_downloads" }>, ctx: RunContext): Promise<ToolResult> {
  const link = await linkFor(ctx, false);
  if (isResult(link)) return link;
  ctx.status("Looking at your downloads");
  const result = await link.ask("downloads", { limit: call.limit });
  return json({ downloads: Array.isArray(result.downloads) ? result.downloads.filter(isRecord) : [] });
}
