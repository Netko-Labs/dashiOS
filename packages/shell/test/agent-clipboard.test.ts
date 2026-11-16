import { expect, test } from "bun:test";
import { kept, NEVER_KEPT } from "../src/agents/consent.ts";
import type { RunContext } from "../src/agents/context.ts";
import { readClipboardHistory } from "../src/agents/desktop/clipboard.ts";
import { type ClipboardCopy, TOOL_ACTIONS } from "../src/agents/index.ts";
import { parseCall, scopeOf } from "../src/agents/tools/registry.ts";

// Agents read the clipboard history only with "See your clipboard history",
// which Always Allow never keeps, and the person says yes to every call.

const copy: ClipboardCopy = { kind: "text", text: "git push", app: "Terminal", copiedAt: "2026-11-05T10:00:00.000Z", pinned: false };

function context(answer: boolean, copies: ClipboardCopy[], asked: string[]): RunContext {
  return {
    desktop: { clipboard: { recent: (limit: number) => copies.slice(0, limit) } },
    status: () => {},
    confirm: async (question: { summary: string }) => {
      asked.push(question.summary);
      return answer;
    },
  } as unknown as RunContext;
}

test("read_clipboard_history takes a limit and needs its own scope; it no longer asks every time (D260)", () => {
  expect(parseCall({ name: "read_clipboard_history", arguments: {} })).toEqual({ name: "read_clipboard_history", limit: 10 });
  expect(parseCall({ name: "read_clipboard_history", arguments: { limit: 51 } })).toHaveProperty("arguments");
  expect(scopeOf({ name: "read_clipboard_history", limit: 1 })).toBe("clipboard");
  expect(NEVER_KEPT.has("clipboard")).toBe(false);
  expect([...kept(new Set(), ["clipboard", "see"], new Set())].sort()).toEqual(["clipboard", "see"]);
  const action = TOOL_ACTIONS.find((each) => each.tool === "read_clipboard_history");
  expect(action?.who).toBe("agents");
  expect(action?.asksEveryTime).toBeUndefined();
});

test("the copies come back with no sheet", async () => {
  const asked: string[] = [];
  const read = await readClipboardHistory(5, context(false, [copy, copy], asked));
  expect(read.isError).toBeUndefined();
  expect(read.structuredContent).toEqual({ copies: [copy, copy] });
  expect(asked).toEqual([]);
});
