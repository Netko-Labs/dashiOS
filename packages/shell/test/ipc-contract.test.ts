/**
 * H9: the IPC has one definition. The compositor's method table
 * (crates/dashi-comp/src/ipc/table.rs), the doc (docs/compositor-ipc.md) and
 * the shell's typed methods (src/compositor/table.ts) name the same methods
 * with the same "who may ask"; the compositor's events, the doc's and the
 * shell's are the same set; and every golden fixture `cargo test` writes from
 * the Rust types (test/fixtures/ipc/) parses with the shell's shapes.
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord, must } from "@dashi/shape";
import { EVENT_NAMES, EventShape } from "../src/compositor/events.ts";
import { METHODS } from "../src/compositor/table.ts";

const repo = join(import.meta.dir, "../../..");
const read = (path: string): string => readFileSync(join(repo, path), "utf8");
const fixture = (name: string): unknown => JSON.parse(read(`test/fixtures/ipc/${name}`));
const sorted = (names: Iterable<string>): string[] => [...names].sort();

/** The compositor's table: method → who. */
function compositorMethods(): Map<string, string> {
  const table = read("crates/dashi-comp/src/ipc/table.rs");
  const rows = [...table.matchAll(/\b(shell|granted|anyone)\("([a-z-]+)"/g)].map((match): [string, string] => [match[2] ?? "", match[1] ?? ""]);
  const later = [...table.matchAll(/name: "([a-z-]+)", who: Who::(\w+)/g)].map((match): [string, string] => [match[1] ?? "", (match[2] ?? "").toLowerCase()]);
  return new Map([...rows, ...later]);
}

/** A section of the doc between two headings. */
const section = (doc: string, from: string, to: string | null): string => {
  const start = doc.indexOf(`\n## ${from}`);
  const end = to === null ? -1 : doc.indexOf(`\n## ${to}`, start);
  return doc.slice(start, end < 0 ? undefined : end);
};

/** The doc's request tables: method → who. */
function documentedMethods(): Map<string, string> {
  const requests = section(read("docs/compositor-ipc.md"), "Requests", "In the 0.2.0 compositor");
  return new Map([...requests.matchAll(/^\| `([a-z][a-z-]*)` \| (\w+) \|/gm)].map((match): [string, string] => [match[1] ?? "", match[2] ?? ""]));
}

/** The compositor's events: its `Event` variants, in kebab-case. */
function compositorEvents(): Set<string> {
  const source = read("crates/dashi-comp/src/ipc/protocol/events.rs");
  const body = source.slice(source.indexOf("pub(crate) enum Event {"));
  const variants = [...body.matchAll(/^ {4}([A-Z][A-Za-z0-9]*)\b/gm)].map((match) => match[1] ?? "");
  return new Set(variants.map((name) => name.replace(/[A-Z]/g, (letter, at: number) => (at === 0 ? "" : "-") + letter.toLowerCase())));
}

test("the compositor, the doc and the shell name the same methods, each with the same who", () => {
  const compositor = compositorMethods();
  const documented = documentedMethods();
  const shell = new Map(Object.entries(METHODS).map(([name, spec]): [string, string] => [name, spec.who]));
  expect(compositor.size).toBeGreaterThan(50);
  expect(sorted(documented.keys())).toEqual(sorted(compositor.keys()));
  expect(sorted(shell.keys())).toEqual(sorted(compositor.keys()));
  for (const [name, who] of compositor) {
    expect(`${name}: ${documented.get(name)}`).toBe(`${name}: ${who}`);
    expect(`${name}: ${shell.get(name)}`).toBe(`${name}: ${who}`);
  }
});

test("the compositor, the doc and the shell name the same events", () => {
  const compositor = compositorEvents();
  const events = section(read("docs/compositor-ipc.md"), "Events", null);
  const documented = new Set([...events.matchAll(/^\| `([a-z][a-z-]*)` \|/gm)].map((match) => match[1] ?? ""));
  expect(compositor.size).toBeGreaterThan(30);
  expect(sorted(documented)).toEqual(sorted(compositor));
  expect(sorted(EVENT_NAMES)).toEqual(sorted(compositor));
});

test("every method's fixture params and reply parse with the shell's shapes", () => {
  const methods = fixture("methods.json");
  if (!isRecord(methods)) throw new Error("test/fixtures/ipc/methods.json is not an object");
  expect(sorted(Object.keys(methods))).toEqual(sorted(Object.keys(METHODS)));
  for (const [name, spec] of Object.entries(METHODS)) {
    const example = methods[name];
    if (!isRecord(example)) throw new Error(`no fixture for ${name}`);
    expect(`${name}: ${example.who}`).toBe(`${name}: ${spec.who}`);
    must(spec.params, example.params, `${name} params`);
    must(spec.reply, example.reply, `${name} reply`);
  }
});

test("every event's fixture parses with the shell's shape, one of each", () => {
  const events = fixture("events.json");
  if (!Array.isArray(events)) throw new Error("test/fixtures/ipc/events.json is not a list");
  const seen = new Set<string>();
  for (const event of events) seen.add(must(EventShape, event, "event").event);
  expect(sorted(seen)).toEqual(sorted(compositorEvents()));
});

// Secrets for agents (0.4.0): every agent capture names its mask.
test("agent captures are masked", () => {
  for (const file of ["packages/shell/src/agents/run.ts", "packages/shell/src/agents/desktop/record.ts"]) {
    expect(read(file)).toContain("mask: AGENT_MASK");
  }
});
