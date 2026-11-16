#!/usr/bin/env bun
/**
 * dashi-a11y-dump (a development aid, run in a session): every window on the
 * accessibility bus as read_window reads it, for the review's dumps and the
 * tests' recorded trees. For each app (or the one running as PID) and each of
 * its windows: the tree as JSON (`Element`s), read_window's text, and a
 * summary of what the toolkit gives (roles, interfaces, actions, ids, text,
 * values). `--events S` also counts the tree events each app sends for S
 * seconds (do things meanwhile).
 *
 *   bun packages/shell/bin/dashi-a11y-dump.ts [--pid PID] [--out DIR] [--rows N] [--events S]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Atspi, type Element, readElements, renderTree, roleWord, TreeNumbers } from "../src/agents/window-tree/index.ts";

const arg = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? (process.argv[at + 1] ?? null) : null;
};
const wanted = arg("--pid") ? Number(arg("--pid")) : null;
const out = arg("--out") ?? "a11y-dump";
const rows = Number(arg("--rows") ?? 300);
const eventsFor = Number(arg("--events") ?? 0);

const atspi = await Atspi.connect();
if (!atspi) {
  console.error("no accessibility bus");
  process.exit(1);
}
mkdirSync(out, { recursive: true });

function summary(root: Element): Record<string, unknown> {
  const roles = new Map<string, number>();
  const interfaces = new Map<string, number>();
  const actions = new Map<string, number>();
  let nodes = 0;
  let ids = 0;
  let texts = 0;
  let values = 0;
  let named = 0;
  const visit = (e: Element): void => {
    nodes++;
    roles.set(roleWord(e.role), (roles.get(roleWord(e.role)) ?? 0) + 1);
    for (const i of e.interfaces) interfaces.set(i, (interfaces.get(i) ?? 0) + 1);
    for (const a of e.actions) actions.set(a, (actions.get(a) ?? 0) + 1);
    if (e.id) ids++;
    if (e.text !== undefined) texts++;
    if (e.value) values++;
    if (e.name) named++;
    for (const c of e.children) visit(c);
  };
  visit(root);
  const sorted = (m: Map<string, number>) => Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
  return { nodes, named, ids, texts, values, roles: sorted(roles), interfaces: sorted(interfaces), actions: sorted(actions) };
}

const safe = (text: string): string => text.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 60) || "untitled";

for (const { pid, app } of await atspi.apps()) {
  if (wanted !== null && pid !== wanted) continue;
  if (pid !== null) await atspi.wake(pid).catch(() => false);
  const frames = await app.children().catch(() => []);
  for (const [index, frame] of frames.entries()) {
    const started = Date.now();
    const { root, complete } = await readElements(frame, { nodes: 20_000, deadline: Date.now() + 20_000, rows: () => ({ from: 0, to: rows }) });
    if (!root) continue;
    const ms = Date.now() - started;
    const numbers = new TreeNumbers();
    const text = renderTree(root, { window: 0, numberOf: (e, p, said) => numbers.number(0, e.key, p?.key ?? null, said) }).text;
    const base = join(out, `${pid}-${index}-${safe(root.name)}`);
    writeFileSync(`${base}.json`, JSON.stringify({ pid, complete, ms, root }, null, 1));
    writeFileSync(`${base}.txt`, text);
    writeFileSync(`${base}.summary.json`, JSON.stringify({ pid, name: root.name, complete, ms, ...summary(root) }, null, 1));
    console.log(`${pid} ${index} “${root.name}”: ${ms} ms, complete ${complete} → ${base}`);
  }
}

if (eventsFor > 0) {
  await atspi.watchChanges();
  const apps = await atspi.apps();
  const before = new Map(apps.map(({ app }) => [app.key ?? "", atspi.changesOf(app).count]));
  await Bun.sleep(eventsFor * 1000);
  for (const { pid, app } of apps) console.log(`events ${pid}: ${atspi.changesOf(app).count - (before.get(app.key ?? "") ?? 0)}`);
}
atspi.close();
process.exit(0);
