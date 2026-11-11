import { describe, expect, test } from "bun:test";
import type { Focused, Rect } from "../src/agents/atspi/tree.ts";
import { kept, NEVER_KEPT, type Scope } from "../src/agents/consent.ts";
import { chooseCard, dollars, type PayContext, parseAmount, payWith } from "../src/agents/secrets/pay.ts";
import type { FieldInfo } from "../src/agents/secrets/types.ts";
import type { CardSummary } from "../src/agents/secrets/vault.ts";

const NUMBER = "4242424242424242";
const rect = (y: number): Rect => ({ x: 10, y, width: 200, height: 24 });

function field(kind: Focused["kind"], y: number, documents = ["http://signin.localhost:8443/checkout"]): FieldInfo {
  return { focused: { kind, rect: rect(y), page: null, documents }, cmdline: ["firefox"] };
}

const card = (over: Partial<CardSummary> = {}): CardSummary => ({
  id: 1,
  label: "Test",
  last4: "4242",
  expiry: "12/34",
  singleUse: true,
  used: false,
  ...over,
});

function harness(options: { fields: FieldInfo[]; cards?: CardSummary[]; refuse?: string }) {
  const typed: unknown[] = [];
  const filled: Array<Rect | null> = [];
  const paid: Array<[string, number, number]> = [];
  let look = 0;
  const ctx: PayContext = {
    inspect: async () => options.fields[Math.min(look++, options.fields.length - 1)] as FieldInfo,
    type: async (payload) => void typed.push(payload),
    status: () => {},
    sleep: async () => {},
    cards: async () => options.cards ?? [card()],
    pay: async (merchant, cents, id) => {
      if (options.refuse) throw new Error(options.refuse);
      paid.push([merchant, cents, id]);
      return { number: new TextEncoder().encode(NUMBER), cvc: new TextEncoder().encode("123"), expiry: "12/34" };
    },
    filled: (f) => void filled.push(f.rect),
  };
  return { ctx, typed, filled, paid };
}

describe("paying for the person", () => {
  test("within the limits and with the person's yes, the card goes into the checkout's fields, blanked, and never into the result", async () => {
    const h = harness({ fields: [field("text", 100), field("text", 100), field("text", 140), field("password", 180)] });
    const result = await payWith(h.ctx, "signin.localhost", 420, null);
    expect(result.isError).toBeUndefined();
    expect(h.paid).toEqual([["signin.localhost", 420, 1]]);
    expect(h.typed).toEqual([
      { keys: [{ text: NUMBER }] },
      { keys: [{ name: "Tab" }] },
      { keys: [{ text: "12/34" }, { name: "Tab" }] },
      { keys: [{ text: "123" }] },
    ]);
    // Each field is blanked before it holds the secret.
    expect(h.filled).toEqual([rect(100), rect(140), rect(180)]);
    expect(JSON.stringify(result)).not.toContain(NUMBER);
    expect(JSON.stringify(result)).toContain("4242");
  });

  test("a page of another site gets no payment at all", async () => {
    const h = harness({ fields: [field("text", 100, ["https://evil.example/checkout"])] });
    expect((await payWith(h.ctx, "signin.localhost", 420, null)).isError).toBe(true);
    expect(h.paid).toEqual([]);
    expect(h.typed).toEqual([]);
  });

  test("over a limit, or not allowed by the person, nothing is typed", async () => {
    for (const refuse of ["that is over the limit per payment ($100.00)", "the person did not allow the payment"]) {
      const h = harness({ fields: [field("text", 100)], refuse });
      const result = await payWith(h.ctx, "signin.localhost", 42_000, null);
      expect(JSON.stringify(result)).toContain(refuse);
      expect(h.typed).toEqual([]);
    }
  });

  test("single-use cards first, a used one never, and the one named when asked", () => {
    const reusable = card({ id: 2, last4: "1111", label: "Visa", singleUse: false });
    const fresh = card({ id: 3, last4: "2222" });
    const used = card({ id: 4, last4: "3333", used: true });
    expect(chooseCard([reusable, used, fresh], null)?.id).toBe(3);
    expect(chooseCard([reusable, used], null)?.id).toBe(2);
    expect(chooseCard([reusable, used], "3333")).toBeNull();
    expect(chooseCard([reusable, fresh], "visa")?.id).toBe(2);
    expect(chooseCard([], null)).toBeNull();
  });

  test("amounts are dollars and cents", () => {
    expect(parseAmount("48.90")).toBe(4890);
    expect(parseAmount("$4.20")).toBe(420);
    expect(parseAmount("12")).toBe(1200);
    for (const bad of ["", "0", "4.2", "-5", "1e9", "48,90"]) expect(parseAmount(bad)).toBeNull();
    expect(dollars(4890)).toBe("$48.90");
  });

  test('"Pay for you" is never kept, by Always Allow or in the file', () => {
    expect(NEVER_KEPT.has("pay")).toBe(true);
    const allowed = kept(new Set<Scope>(["see"]), ["pay", "screen"], new Set());
    expect([...allowed].sort()).toEqual(["screen", "see"]);
  });
});
