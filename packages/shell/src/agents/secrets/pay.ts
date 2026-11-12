/**
 * Paying for the person (docs/secrets.md, "Payments"): a saved card, a
 * single-use one first, filled into a checkout on the merchant's own site
 * the way a login is (secrets/broker.ts). The limits and the question to the
 * person (finger or password) are dashi-secretd's; this checks the page,
 * types the number, the expiry and the code into the fields that follow each
 * other (Tab), has them blanked in agents' pictures, and drops them.
 */

import type { Placed } from "../atspi/index.ts";
import { type ToolResult, text, toolError } from "../context.ts";
import { type BrokerContext, GAVE_UP } from "./broker.ts";
import { checkField } from "./lib/field-check.ts";
import type { CardSummary } from "./vault.ts";

export interface PayContext extends Pick<BrokerContext, "inspect" | "type" | "status" | "sleep" | "cancelled" | "exclusive"> {
  cards(): Promise<CardSummary[]>;
  /** dashi-secretd: within the limits, asked of the person, then the card. */
  pay(merchant: string, cents: number, card: number): Promise<{ number: Uint8Array; cvc: Uint8Array; expiry: string }>;
  /** A field Dashi typed a secret into: agents' pictures blank it from now on. */
  filled(field: Placed): void;
}

const SETTLE_MS = 200;

/** "48.90", "$48.90", "48" to cents; null for anything else (or nothing). */
export function parseAmount(text: string): number | null {
  const match = /^\s*\$?\s*(\d{1,6})(?:\.(\d{2}))?\s*$/.exec(text);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number(match[2] ?? "0");
  return cents > 0 ? cents : null;
}

export const dollars = (cents: number): string => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

/** The card to use: the one named (its last four digits or its label), else a single-use one first. */
export function chooseCard(cards: readonly CardSummary[], hint: string | null): CardSummary | null {
  const usable = cards.filter((card) => !(card.singleUse && card.used));
  if (hint) {
    const wanted = hint.trim().toLowerCase();
    return usable.find((card) => card.last4 === wanted.replace(/\D/g, "").slice(-4) || card.label.toLowerCase() === wanted) ?? null;
  }
  return usable.find((card) => card.singleUse) ?? usable[0] ?? null;
}

async function typeInto(ctx: PayContext, secret: Uint8Array, field: Placed): Promise<void> {
  const value = new TextDecoder().decode(secret);
  secret.fill(0);
  ctx.filled(field);
  await ctx.type({ keys: [{ text: value }] });
}

export async function payWith(ctx: PayContext, site: string, cents: number, hint: string | null): Promise<ToolResult> {
  const first = checkField(await ctx.inspect(), "code", site);
  if (!first.ok) return toolError(`${first.reason} Click into the card number field of the checkout first.`);
  const card = chooseCard(await ctx.cards(), hint);
  if (!card) return toolError("There is no card to pay with (or the one named was used). Ask the person to add a single-use card in Settings › Passwords.");
  ctx.status(`Waiting for you to pay ${site} ${dollars(cents)}`);
  if (ctx.cancelled?.()) return toolError(GAVE_UP);
  let details: { number: Uint8Array; cvc: Uint8Array; expiry: string };
  try {
    details = await ctx.pay(site, cents, card.id);
  } catch (error) {
    return toolError(`No payment: ${error instanceof Error ? error.message : String(error)}.`);
  }
  const fill = () => fillCard(ctx, site, details);
  const failed = await (ctx.exclusive ? ctx.exclusive(fill) : fill());
  if (failed) return failed;
  return text(
    `Dashi filled the card ending ${card.last4} for ${dollars(cents)} on ${site}; you never see it. Press the page's pay button, then take a screenshot.`,
    {
      site,
      amount: dollars(cents),
      card: card.last4,
    },
  );
}

/** The number, the expiry and the code, field by field, the page checked at each; null when all went in. */
async function fillCard(ctx: PayContext, site: string, details: { number: Uint8Array; cvc: Uint8Array; expiry: string }): Promise<ToolResult | null> {
  try {
    if (ctx.cancelled?.()) return toolError(`${GAVE_UP} The payment was allowed, so tell the person.`);
    let now = checkField(await ctx.inspect(), "code", site);
    if (!now.ok) return toolError(`${now.reason} The card was not typed.`);
    await typeInto(ctx, details.number, now.focused);
    await ctx.type({ keys: [{ name: "Tab" }] });
    await ctx.sleep(SETTLE_MS);
    now = checkField(await ctx.inspect(), "code", site);
    if (!now.ok) return toolError(`${now.reason} Only the card number was typed.`);
    ctx.filled(now.focused);
    await ctx.type({ keys: [{ text: details.expiry }, { name: "Tab" }] });
    await ctx.sleep(SETTLE_MS);
    now = checkField(await ctx.inspect(), "code", site);
    if (!now.ok) return toolError(`${now.reason} The security code was not typed.`);
    await typeInto(ctx, details.cvc, now.focused);
    return null;
  } finally {
    details.number.fill(0);
    details.cvc.fill(0);
  }
}
