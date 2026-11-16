/**
 * The shell's newer requests (methods.ts has the first ones): an element's
 * box, its picture and a click at a point of it (canvas.ts), the downloads,
 * and a file put into a file field in chunks.
 */

import { takeChunk } from "../page/chunks.ts";
import { boxIn, shotOf } from "./canvas.ts";
import { listDownloads } from "./downloads.ts";
import { ask } from "./frames.ts";
import { idOf, info, type Params, tabOf, targetOf } from "./targets.ts";

export const MORE_METHODS: Record<string, (params: Params) => Promise<Record<string, unknown>>> = {
  box: async (params) => {
    const tab = idOf(await tabOf(params));
    const target = await targetOf(tab, params.ref);
    return { ...(await boxIn(tab, target, false)), tab: info(await chrome.tabs.get(tab)), frameId: target.frameId };
  },
  shot: async (params) => {
    const tab = idOf(await tabOf(params));
    return shotOf(tab, await targetOf(tab, params.ref));
  },
  point: async (params) => {
    const tab = idOf(await tabOf(params));
    const target = await targetOf(tab, params.ref);
    return ask(tab, target.frameId, { op: "point", doc: target.doc, ref: target.local, x: params.x, y: params.y });
  },
  downloads: async (params) => listDownloads(typeof params.limit === "number" ? params.limit : 20),
  attach: async (params) => {
    const whole = takeChunk(String(params.id ?? ""), Number(params.index ?? 0), Number(params.total ?? 1), String(params.chunk ?? ""));
    if (whole === null) return { received: params.index };
    const tab = idOf(await tabOf(params));
    const target = await targetOf(tab, params.ref);
    return ask(tab, target.frameId, { op: "attach", doc: target.doc, ref: target.local, name: params.name, type: params.type, data: whole });
  },
};
