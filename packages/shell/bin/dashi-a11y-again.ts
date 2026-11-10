#!/usr/bin/env bun
/**
 * dashi-a11y-again (a development aid, run in a session): finds the focused
 * password field of app PID, waits WAIT seconds (navigate meanwhile), then asks for
 * the same node again, timed: what the agents' mask does for a field Dashi
 * filled once its page is gone.
 *
 *   bun packages/shell/bin/dashi-a11y-again.ts PID [WAIT]
 */

import { Atspi } from "../src/agents/atspi/client.ts";
import { type A11yNode, documents, hasState, limits, placeAgain, ROLE, STATE } from "../src/agents/atspi/tree.ts";

/** The first password field under `node`, depth first. */
async function passwordField(node: A11yNode, depth = 0): Promise<A11yNode | null> {
  if (depth > 40) return null;
  if ((await node.role().catch(() => -1)) === ROLE.PASSWORD_TEXT) return node;
  for (const child of await node.children().catch(() => [])) {
    const found = await passwordField(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/** A node's D-Bus path, when it has one. */
const pathOf = (node: A11yNode): string | undefined => ("path" in node && typeof node.path === "string" ? node.path : undefined);

/** A node's D-Bus path, its address and whether it shows. */
async function describe(node: A11yNode): Promise<string> {
  const states = await node.states().catch(() => null);
  const url = await node.url().catch(() => null);
  return `${pathOf(node)} ${url} ${states ? (hasState(states, STATE.SHOWING) ? "showing" : "hidden") : "no states"}`;
}

const atspi = await Atspi.connect();
const pid = Number(process.argv[2]);
const wait = Number(process.argv[3] ?? 15);
if (!atspi || !pid) {
  console.error("usage: dashi-a11y-again PID [WAIT]");
  process.exit(1);
}
await atspi.wake(pid);
await Bun.sleep(1200);
const app = await atspi.appFor(pid);
const docs = app ? await documents(app, limits(2000, 8000)) : [];
const page = docs[0] ?? null;
const node = page ? await passwordField(page) : null;
if (!node) {
  console.log("no password field");
  process.exit(1);
}
const field = { again: () => placeAgain(node, page) };
console.log(`now: ${JSON.stringify(await field.again())}; waiting ${wait} s`);
const before = app ? await documents(app, limits(2000, 8000)) : [];
for (const doc of before) console.log(`document before: ${await describe(doc)}`);
await Bun.sleep(wait * 1000);
for (let round = 0; round < 3; round++) {
  const at = Date.now();
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve("(no answer in 5 s)"), 5000));
  const again = await Promise.race([field.again().catch((e: unknown) => `error ${e}`), timeout]);
  console.log(`again after the wait: ${JSON.stringify(again)} in ${Date.now() - at} ms`);
}
const after = app ? await documents(app, limits(2000, 8000)) : [];
for (const doc of after) console.log(`document after: ${await describe(doc)}`);
for (const doc of before) {
  console.log(`the old document now: ${await describe(doc)}`);
  const parent = await doc.parent?.().catch(() => null);
  const kids = parent ? await parent.children().catch(() => []) : [];
  console.log(`its parent ${parent ? pathOf(parent) : null} has ${kids.map(pathOf).join(" ")}`);
}
atspi.close();
process.exit(0);
