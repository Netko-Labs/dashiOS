import { expect, test } from "bun:test";
import { parseEvent, describe as words } from "../src/agents/secrets/approvals.ts";

test("the vault's questions parse, and nonsense is ignored", () => {
  expect(parseEvent('{"event":"approve","id":3,"kind":"passkey-sign-in","rp":"signin.localhost","user":"alexk"}')).toEqual({
    event: "approve",
    question: { id: 3, kind: "passkey-sign-in", rp: "signin.localhost", user: "alexk" },
  });
  expect(parseEvent('{"event":"answered","id":3}')).toEqual({ event: "answered", id: 3 });
  for (const line of ["", "nope", '{"ok":true}', '{"event":"approve","id":"3","kind":"pay"}', '{"event":"approve","id":3,"kind":"rm -rf"}']) {
    expect(parseEvent(line)).toBeNull();
  }
  // Control characters from a site's name don't reach the sheet.
  const tricky = parseEvent('{"event":"approve","id":4,"kind":"passkey-register","rp":"a\\u0007b.example","user":""}');
  expect(tricky?.event === "approve" && tricky.question.rp).toBe("ab.example");
});

test("the sheet says what is asked", () => {
  expect(words({ id: 1, kind: "passkey-sign-in", rp: "github.com", user: "alexk" }).title).toBe("Use your passkey for github.com?");
  expect(words({ id: 1, kind: "passkey-register", rp: "github.com", user: "" }).detail).toContain("As you");
  expect(words({ id: 1, kind: "pay", rp: "Uniqlo", user: "", amount: "$48.90" }).title).toBe("Pay Uniqlo $48.90?");
});
