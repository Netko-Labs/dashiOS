import { expect, test } from "bun:test";
import type { Question } from "../src/agents/confirm.ts";
import { kept, NEVER_KEPT } from "../src/agents/consent.ts";
import type { RunContext } from "../src/agents/context.ts";
import { readClipboardHistory } from "../src/agents/desktop/clipboard.ts";
import type { ClipboardCopy } from "../src/agents/desktop/types.ts";
import { TOOL_ACTIONS } from "../src/agents/tools/index.ts";
import { parseCall, scopeOf } from "../src/agents/tools/registry.ts";
import { goAheadLook } from "../src/consent.tsx";

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

test("read_clipboard_history takes a limit, needs its own scope, and asks every time", () => {
  expect(parseCall({ name: "read_clipboard_history", arguments: {} })).toEqual({ name: "read_clipboard_history", limit: 10 });
  expect(parseCall({ name: "read_clipboard_history", arguments: { limit: 51 } })).toHaveProperty("arguments");
  expect(scopeOf({ name: "read_clipboard_history", limit: 1 })).toBe("clipboard");
  expect(NEVER_KEPT.has("clipboard")).toBe(true);
  expect([...kept(new Set(), ["clipboard", "see"], new Set())]).toEqual(["see"]);
  const action = TOOL_ACTIONS.find((each) => each.tool === "read_clipboard_history");
  expect(action?.who).toBe("agents");
  expect(action?.asksEveryTime).toBe(true);
});

test("the person sees how many copies, and no is no", async () => {
  const asked: string[] = [];
  const yes = await readClipboardHistory(5, context(true, [copy, copy], asked));
  expect(yes.isError).toBeUndefined();
  expect(yes.structuredContent).toEqual({ copies: [copy, copy] });
  const no = await readClipboardHistory(1, context(false, [copy, copy], asked));
  expect(no.isError).toBe(true);
  expect(asked).toEqual(["see your last 2 copies", "see your last copy"]);
});

test("Show Copies is the sheet's primary button, not a red one: seeing copies loses nothing", async () => {
  const questions: Question[] = [];
  const ctx = {
    desktop: { clipboard: { recent: () => [copy] } },
    status: () => {},
    confirm: async (question: Question) => {
      questions.push(question);
      return false;
    },
  } as unknown as RunContext;
  await readClipboardHistory(1, ctx);
  expect(questions[0]?.action).toBe("Show Copies");
  expect(goAheadLook(questions[0]?.danger)).toEqual({ primary: true });
  expect(goAheadLook(true)).toEqual({ danger: true });
});
