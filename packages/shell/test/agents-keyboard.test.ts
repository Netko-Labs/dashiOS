import { expect, test } from "bun:test";
import { ROLE, STATE } from "../src/agents/atspi/tree.ts";
import type { RunContext } from "../src/agents/context.ts";
import { keyboardIn, keyboardWords } from "../src/agents/desktop/keyboard.ts";
import { tree } from "./fixtures/a11y-tree.ts";

const rect = { x: 0, y: 0, width: 100, height: 20 };
const withFocus = (node: ReturnType<typeof tree> | null) =>
  ({ secrets: { atspi: async () => ({ appFor: async () => null, focusedIn: async () => node }) } }) as unknown as Pick<RunContext, "secrets">;

test("the window with the keyboard says what kind of field has it, never its name or value", async () => {
  expect(await keyboardIn(7, withFocus(tree({ role: ROLE.ENTRY, states: [STATE.FOCUSED, STATE.EDITABLE], rect })))).toBe("text field");
  expect(await keyboardIn(7, withFocus(tree({ role: ROLE.PASSWORD_TEXT, states: [STATE.FOCUSED], rect })))).toBe("password field");
  expect(await keyboardIn(7, withFocus(tree({ role: 43, states: [STATE.FOCUSED], rect })))).toBe("no text field");
  // Focus that moved on with no event: not a field any more.
  expect(await keyboardIn(7, withFocus(tree({ role: ROLE.ENTRY, states: [STATE.EDITABLE], rect })))).toBe("no text field");
});

test("where accessibility can't tell, nothing is said", async () => {
  expect(await keyboardIn(7, withFocus(null))).toBeNull();
  expect(await keyboardIn(null, withFocus(null))).toBeNull();
  expect(await keyboardIn(7, { secrets: { atspi: async () => null } } as unknown as Pick<RunContext, "secrets">)).toBeNull();
  expect(await keyboardIn(7, {} as unknown as Pick<RunContext, "secrets">)).toBeNull();
  expect(keyboardWords(null)).toBe("");
  expect(keyboardWords("text field")).toBe(" A text field has the keyboard there now.");
  expect(keyboardWords("no text field")).toContain("would not land");
});
