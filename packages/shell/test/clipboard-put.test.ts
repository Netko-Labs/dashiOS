import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCall } from "../src/agents/index.ts";
import { ClipboardHistory } from "../src/clipboard/history.ts";
import { putText } from "../src/clipboard/lib/put.ts";

test("an agent's text is on the clipboard and in the history as Dashi's; the watch keeps it so", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-clip-"));
  try {
    const history = new ClipboardHistory({ dir, sync: true });
    history.add({ kind: "text", mime: "text/plain;charset=utf-8", text: "before", app: "Notes" });
    const written: string[] = [];
    const expected: Array<[string, string, string]> = [];
    const ok = await putText("https://lichess.org/abc", "Dashi", {
      history,
      io: { write: async (_mime: string, text: string | Uint8Array) => (written.push(String(text)), true), read: async () => null } as never,
      watch: { expect: (kind, content, how) => void expected.push([kind, String(content), how]), nextCopy: async () => true },
      enabled: () => true,
    });
    expect(ok).toBe(true);
    expect(written).toEqual(["https://lichess.org/abc"]);
    expect(expected).toEqual([["text", "https://lichess.org/abc", "bump"]]);
    const [top, next] = history.getSnapshot().entries;
    expect(top).toMatchObject({ text: "https://lichess.org/abc", app: "Dashi" });
    expect(next).toMatchObject({ text: "before", app: "Notes" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("copy_to_clipboard takes text, and no empty text", () => {
  expect(parseCall({ name: "copy_to_clipboard", arguments: { text: "hi" } })).toEqual({ name: "copy_to_clipboard", text: "hi" });
  expect(parseCall({ name: "copy_to_clipboard", arguments: { text: "" } })).toEqual({ arguments: expect.stringContaining("1 to 100,000") });
});
