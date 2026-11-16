import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takeChunk } from "../browser-extension/src/page/chunks.ts";
import type { RunContext } from "../src/agents/context.ts";
import { downloadWords } from "../src/agents/desktop/lib/download-words.ts";
import { attachFile } from "../src/agents/desktop/transfer.ts";
import { parseCall } from "../src/agents/index.ts";

let home = "";
const saved = process.env.HOME;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "dashi-attach-")));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

test("chunks come together in order, whatever order they arrive in", () => {
  expect(takeChunk("a", 1, 3, "BB")).toBeNull();
  expect(takeChunk("a", 0, 3, "AA")).toBeNull();
  expect(takeChunk("a", 2, 3, "CC")).toBe("AABBCC");
  expect(takeChunk("b", 0, 1, "X")).toBe("X");
});

test("a file goes to the page in chunks, read under the files' rules; a secret never does", async () => {
  writeFileSync(join(home, "cv.pdf"), Buffer.alloc(700 * 1024, 7));
  const sent: Array<Record<string, unknown>> = [];
  const link = {
    hello: { browserPid: 1 },
    ask: async (method: string, params: Record<string, unknown>) => {
      if (method === "tabs")
        return { tabs: [{ id: 4, windowId: 1, active: true, title: "Jobs", url: "https://jobs.example/apply", loading: false }], focusedWindow: 1 };
      sent.push(params);
      return params.index === Number(params.total) - 1 ? { files: 1, accept: ".pdf" } : { received: params.index };
    },
  };
  const ctx = {
    browser: { link: () => link, whenConnected: async () => link, allowSite: async () => true, mayUse: () => true, tab: null },
    status: () => {},
  } as unknown as RunContext;
  const call = parseCall({ name: "attach_file", arguments: { ref: 9, path: "~/cv.pdf" } });
  if ("arguments" in call || "unknown" in call || call.name !== "attach_file") throw new Error("refused");
  const result = await attachFile(call, ctx);
  expect(result.structuredContent).toEqual({ attached: "cv.pdf", bytes: 700 * 1024 });
  expect(sent).toHaveLength(2);
  expect(sent.map((each) => each.index)).toEqual([0, 1]);
  expect(Buffer.from(sent.map((each) => String(each.chunk)).join(""), "base64").length).toBe(700 * 1024);
  writeFileSync(join(home, ".env"), "KEY=1");
  expect((await attachFile({ ...call, path: "~/.env" }, ctx)).isError).toBe(true);
});

test("a click's download says where it landed", () => {
  expect(downloadWords({ state: "complete", path: "/home/alexk/Downloads/r.pdf", bytes: 12 })).toBe(
    "It downloaded a file: /home/alexk/Downloads/r.pdf (12 bytes).",
  );
  expect(downloadWords({ state: "in_progress", path: "/x", bytes: 1 })).toContain("wait_for");
  expect(parseCall({ name: "list_downloads", arguments: {} })).toEqual({ name: "list_downloads", limit: 20 });
});
