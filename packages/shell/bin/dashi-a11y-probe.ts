#!/usr/bin/env bun
/**
 * dashi-a11y-probe: what Dashi's sign-in sees of an app through AT-SPI (a
 * development aid, run in a session): for each app on the accessibility bus,
 * its pid, how many nodes a bounded walk finds, its password fields, and the
 * focused field with the addresses around it.
 *
 *   bun packages/shell/bin/dashi-a11y-probe.ts [PID] [--wake] [--dump]
 */

import { Atspi } from "../src/agents/atspi/client.ts";
import { type A11yNode, documents, fieldAt, focusedField, hasState, limits, passwordFields, ROLE, STATE } from "../src/agents/atspi/tree.ts";

const atspi = await Atspi.connect();
if (!atspi) {
  console.error("no accessibility bus");
  process.exit(1);
}
const wanted = process.argv[2] ? Number(process.argv[2]) : null;
const dump = process.argv.includes("--dump");

/** The tree's roles (and documents' addresses), to `depth`. */
async function print(node: A11yNode, depth: number, indent = ""): Promise<void> {
  const [role, states, children] = await Promise.all([node.role(), node.states(), node.children().catch(() => [])]);
  const url = role === ROLE.DOCUMENT_WEB ? ` ${await node.url().catch(() => null)}` : "";
  console.log(
    `${indent}role ${role}${hasState(states, STATE.SHOWING) ? " showing" : ""}${hasState(states, STATE.FOCUSED) ? " focused" : ""} children ${children.length}${url}`,
  );
  if (depth > 0) for (const child of children.slice(0, 8)) await print(child, depth - 1, `${indent}  `);
}

/** Every document, password field and entry, showing or not (the walk Dashi does skips what isn't showing). */
async function find(node: A11yNode, depth = 0, budget = { nodes: 30_000 }): Promise<void> {
  if (--budget.nodes < 0 || depth > 60) return;
  const [role, states, children] = await Promise.all([node.role(), node.states(), node.children().catch(() => [])]);
  if (role === ROLE.DOCUMENT_WEB || role === ROLE.PASSWORD_TEXT || role === ROLE.ENTRY) {
    const url = role === ROLE.DOCUMENT_WEB ? ` ${await node.url().catch(() => null)}` : "";
    const rect = JSON.stringify(await node.extents().catch(() => null));
    console.log(
      `depth ${depth} role ${role}${hasState(states, STATE.SHOWING) ? " showing" : ""}${hasState(states, STATE.FOCUSED) ? " focused" : ""}${url} ${rect}`,
    );
  }
  for (const child of children) await find(child, depth + 1, budget);
}

for (const { pid, app } of await atspi.apps()) {
  if (wanted === 0) console.log(`app pid ${pid}`);
  if (wanted !== null && pid !== wanted) continue;
  if (process.argv.includes("--wake") && pid !== null && (await atspi.wake(pid))) {
    console.log(`woke ${pid}`);
    await Bun.sleep(2000);
  }
  if (dump) await print(app, 9);
  if (process.argv.includes("--ask-docs")) {
    const docs = await documents(app, limits(2000, 8000));
    console.log(`asking ${docs.length} documents`);
    for (const doc of docs) await doc.attributes?.();
    await Bun.sleep(2000);
  }
  if (process.argv.includes("--find")) await find(app);
  if (process.argv.includes("--time") && pid !== null) {
    const at = Date.now();
    const leaf = await atspi.focusedIn(pid);
    console.log(`focusedIn ${Date.now() - at} ms: ${leaf !== null}`);
    const field = leaf ? await fieldAt(leaf) : null;
    console.log(`fieldAt ${Date.now() - at} ms: ${JSON.stringify(field)}`);
    const found = await focusedField(app, limits(1500, 8000));
    console.log(`focusedField ${Date.now() - at} ms: ${JSON.stringify(found)}`);
  }
  const { rects, complete } = await passwordFields(app, limits(3000, 20_000));
  const focused = (pid !== null ? await atspi.focusedIn(pid) : null) ?? null;
  const field = await focusedField(app, limits(3000, 20_000));
  console.log(JSON.stringify({ pid, passwordFields: rects, complete, focusEvent: focused !== null, focused: field }));
}
atspi.close();
process.exit(0);
