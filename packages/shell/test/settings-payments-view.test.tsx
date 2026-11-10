import { expect, test } from "bun:test";
import { type NativeRoot, type NativeTransport, render, View } from "@mirinjs/metal";
import type { Vault } from "../src/agents/secrets/vault.ts";
import { Payments } from "../src/settings-app/panes/payments.tsx";
import { settle } from "./support/time.ts";

// Settings › Passwords' payments on a stand-in for the Metal host, over a vault of the test's.

function mount(vault: Pick<Vault, "cards" | "spending">): NativeRoot {
  const transport: NativeTransport = { send() {}, onEvent() {}, onClose() {}, simulate() {}, close() {} };
  return render(
    <View style={{ flex: 1 }}>
      <Payments vault={vault as Vault} />
    </View>,
    transport,
  );
}

test("limits that can't be read say so instead of leaving the section out", async () => {
  const error = console.error;
  console.error = () => {};
  try {
    const root = mount({ cards: async () => [], spending: () => Promise.reject(new Error("vault locked")) });
    await settle();
    expect(root.nodeId("payments-limits-unread")).toBeDefined();
    expect(root.lastTree()).toContain("The limits can't be shown right now.");
    root.unmount();
  } finally {
    console.error = error;
  }
});

test("limits that are read show what they are now", async () => {
  const root = mount({ cards: async () => [], spending: async () => ({ perPayment: 100, perMonth: 300, spentThisMonth: 40 }) });
  await settle();
  expect(root.nodeId("payments-limits-unread")).toBeUndefined();
  expect(root.nodeId("payments-per-payment")).toBeDefined();
  root.unmount();
});
