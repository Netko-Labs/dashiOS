/**
 * An extension's view as data (docs/launcher-extensions.md, "The wire"): a
 * tree of the elements in elements.ts, `{"t":"List","i":"n1","p":{…},"c":[…]}`,
 * sent whole (`tree`) and then as patches (`patch`). The shell checks every
 * tree here before it draws a node of it, and the SDK diffs here what it
 * sends, so both sides agree on what a tree may be.
 *
 * Every node has an id (`i`): the shell names it back in events (an action
 * chosen, the selection moved), and the extension keeps the callbacks.
 */

import { isRecord } from "@dashi/shape";
import { isRefusal, id as parseId, text as parseText, type Refusal, refuse } from "@dashi/shape/kit";
import { ELEMENTS, type ElementType, isElementType, type PropSpec, ROOTS, TREE_LIMITS } from "./elements.ts";

export type PropValue = string | number | boolean | readonly string[];

export interface ViewNode {
  t: ElementType;
  i: string;
  p: Readonly<Record<string, PropValue>>;
  c: readonly ViewNode[];
}

/** A change to a tree: a node replaced, put before the one at `path` (or at the end), or taken away. */
export type PatchOp =
  | { op: "replace"; path: readonly number[]; node: ViewNode }
  | { op: "insert"; path: readonly number[]; node: ViewNode }
  | { op: "remove"; path: readonly number[] };

function parseProp(value: unknown, spec: PropSpec, where: string): PropValue | Refusal {
  switch (spec.kind) {
    case "text":
      return parseText(value, where, spec.max);
    case "long":
      if (typeof value !== "string") return refuse(`${where} must be a string`);
      return [...value].length > spec.max ? refuse(`${where} is longer than ${spec.max} characters`) : value;
    case "word":
      return typeof value === "string" && spec.of.includes(value) ? value : refuse(`${where} must be one of ${spec.of.join(", ")}`);
    case "words": {
      if (!Array.isArray(value) || value.length > spec.max) return refuse(`${where} must be a list of at most ${spec.max}`);
      const words: string[] = [];
      for (const word of value) {
        const parsed = parseText(word, where, spec.each);
        if (isRefusal(parsed)) return parsed;
        words.push(parsed);
      }
      return words;
    }
    case "flag":
      return typeof value === "boolean" ? value : refuse(`${where} must be true or false`);
    case "count":
      return typeof value === "number" && Number.isInteger(value) && value >= spec.min && value <= spec.max
        ? value
        : refuse(`${where} must be a whole number from ${spec.min} to ${spec.max}`);
  }
}

function parseProps(type: ElementType, value: unknown, where: string): Record<string, PropValue> | Refusal {
  const specs: Readonly<Record<string, PropSpec>> = ELEMENTS[type].props;
  const given = value === undefined ? {} : value;
  if (!isRecord(given)) return refuse(`${where}: p must be an object`);
  const props: Record<string, PropValue> = {};
  for (const [name, raw] of Object.entries(given)) {
    const spec = specs[name];
    if (!spec) return refuse(`${where}: ${type} has no prop “${name}”`);
    if (raw === undefined || raw === null) continue;
    const parsed = parseProp(raw, spec, `${where}: ${name}`);
    if (isRefusal(parsed)) return parsed;
    props[name] = parsed;
  }
  for (const [name, spec] of Object.entries(specs))
    if ("required" in spec && spec.required && props[name] === undefined) return refuse(`${where}: ${type} needs “${name}”`);
  return props;
}

interface Budget {
  nodes: number;
  ids: Set<string>;
}

function parseNode(value: unknown, parent: ElementType | null, depth: number, budget: Budget): ViewNode | Refusal {
  if (!isRecord(value)) return refuse("a node must be an object");
  const stray = Object.keys(value).find((key) => !["t", "i", "p", "c"].includes(key));
  if (stray !== undefined) return refuse(`a node has an unknown field “${stray}”`);
  if (!isElementType(value.t)) return refuse(`“${String(value.t)}” is not an element`);
  const type = value.t;
  const nodeId = parseId(value.i, `${type}: i`, 128);
  if (isRefusal(nodeId)) return nodeId;
  const where = `${type} “${nodeId}”`;
  if (parent === null ? !ROOTS.includes(type) : !(ELEMENTS[parent].holds as readonly string[]).includes(type))
    return refuse(parent === null ? `a view is a ${ROOTS.join(", ")}, not a ${type}` : `${parent} can't hold ${where}`);
  if (budget.ids.has(nodeId)) return refuse(`two nodes are “${nodeId}”`);
  budget.ids.add(nodeId);
  if (++budget.nodes > TREE_LIMITS.nodes) return refuse(`a view has more than ${TREE_LIMITS.nodes} nodes`);
  if (depth > TREE_LIMITS.depth) return refuse(`a view is deeper than ${TREE_LIMITS.depth}`);
  const props = parseProps(type, value.p, where);
  if (isRefusal(props)) return props;
  const rawChildren = value.c === undefined ? [] : value.c;
  if (!Array.isArray(rawChildren)) return refuse(`${where}: c must be a list`);
  const children: ViewNode[] = [];
  for (const child of rawChildren) {
    const parsed = parseNode(child, type, depth + 1, budget);
    if (isRefusal(parsed)) return parsed;
    children.push(parsed);
  }
  return { t: type, i: nodeId, p: props, c: children };
}

/** A whole view's tree, checked: its root a List, Grid or Detail, every node allowed where it is, the limits held. */
export function parseTree(value: unknown): ViewNode | Refusal {
  return parseNode(value, null, 1, { nodes: 0, ids: new Set() });
}

/** One node to put under `parent` (a patch's), checked as part of a tree. */
export function parseSubtree(value: unknown, parent: ElementType | null): ViewNode | Refusal {
  return parseNode(value, parent, 1, { nodes: 0, ids: new Set() });
}

/** The node at `path` (child indexes from the root), or undefined. */
export function nodeAt(root: ViewNode, path: readonly number[]): ViewNode | undefined {
  let node: ViewNode | undefined = root;
  for (const at of path) node = node?.c[at];
  return node;
}

function replaceAt(root: ViewNode, path: readonly number[], change: (children: ViewNode[], at: number) => void): ViewNode {
  const [first, ...rest] = path;
  if (first === undefined) return root;
  const children = [...root.c];
  if (rest.length === 0) change(children, first);
  else {
    const child = children[first];
    if (child) children[first] = replaceAt(child, rest, change);
  }
  return { ...root, c: children };
}

/** `root` with `ops` applied, checked again as a whole; or why not. */
export function applyPatch(root: ViewNode, ops: readonly unknown[]): ViewNode | Refusal {
  let next: ViewNode = root;
  for (const raw of ops) {
    if (!isRecord(raw) || !Array.isArray(raw.path) || !raw.path.every((at) => Number.isInteger(at) && at >= 0)) return refuse("a patch op needs a path");
    const path: number[] = raw.path.filter((at): at is number => typeof at === "number");
    if (raw.op === "replace" && path.length === 0) {
      const whole = parseTree(raw.node);
      if (isRefusal(whole)) return whole;
      next = whole;
      continue;
    }
    const parent = nodeAt(next, path.slice(0, -1));
    const at = path.at(-1) ?? 0;
    if (!parent || path.length === 0) return refuse("a patch op's path is not in the tree");
    if (raw.op === "remove") {
      if (at >= parent.c.length) return refuse("a patch removes a node that isn't there");
      next = replaceAt(next, path, (children, index) => children.splice(index, 1));
      continue;
    }
    if (raw.op !== "replace" && raw.op !== "insert") return refuse('a patch op is "replace", "insert" or "remove"');
    const node = parseSubtree(raw.node, parent.t);
    if (isRefusal(node)) return node;
    if (raw.op === "replace" ? at >= parent.c.length : at > parent.c.length) return refuse("a patch's path is not in the tree");
    next = replaceAt(next, path, (children, index) => (raw.op === "replace" ? children.splice(index, 1, node) : children.splice(index, 0, node)));
  }
  // The whole is checked again: ids stay unique, the limits hold.
  return parseTree(toWire(next));
}

/** The node as it goes on the wire: no empty `p` or `c`. */
export function toWire(node: ViewNode): Record<string, unknown> {
  return {
    t: node.t,
    i: node.i,
    ...(Object.keys(node.p).length > 0 ? { p: node.p } : {}),
    ...(node.c.length > 0 ? { c: node.c.map(toWire) } : {}),
  };
}

const sameProps = (a: ViewNode["p"], b: ViewNode["p"]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What turns `before` into `after`: the smallest nodes that changed are replaced; rows added or taken away are inserted or removed. */
export function diffTrees(before: ViewNode, after: ViewNode): PatchOp[] {
  const ops: PatchOp[] = [];
  walk(before, after, [], ops);
  return ops;
}

function walk(a: ViewNode, b: ViewNode, path: number[], ops: PatchOp[]): void {
  if (a.t !== b.t || a.i !== b.i || !sameProps(a.p, b.p)) {
    ops.push({ op: "replace", path, node: b });
    return;
  }
  // The children that kept their place at the start and at the end are compared; the middle is taken out and put in.
  let head = 0;
  while (head < a.c.length && head < b.c.length && a.c[head]?.i === b.c[head]?.i) head++;
  let tail = 0;
  while (tail < a.c.length - head && tail < b.c.length - head && a.c[a.c.length - 1 - tail]?.i === b.c[b.c.length - 1 - tail]?.i) tail++;
  for (let at = 0; at < head; at++) walk(a.c[at] as ViewNode, b.c[at] as ViewNode, [...path, at], ops);
  for (let at = a.c.length - tail - 1; at >= head; at--) ops.push({ op: "remove", path: [...path, at] });
  for (let at = head; at < b.c.length - tail; at++) ops.push({ op: "insert", path: [...path, at], node: b.c[at] as ViewNode });
  for (let back = 1; back <= tail; back++) {
    const before = a.c[a.c.length - back] as ViewNode;
    const after = b.c[b.c.length - back] as ViewNode;
    walk(before, after, [...path, b.c.length - back], ops);
  }
}

/** Every node, depth first, with its path. */
export function* nodes(root: ViewNode, path: number[] = []): Generator<{ node: ViewNode; path: number[] }> {
  yield { node: root, path };
  for (const [at, child] of root.c.entries()) yield* nodes(child, [...path, at]);
}

/** The node with id `nodeId`, or undefined. */
export function findNode(root: ViewNode, nodeId: string): ViewNode | undefined {
  for (const { node } of nodes(root)) if (node.i === nodeId) return node;
  return undefined;
}

/** A prop as words, or undefined. */
export const textProp = (node: ViewNode, name: string): string | undefined => {
  const value = node.p[name];
  return typeof value === "string" ? value : undefined;
};
