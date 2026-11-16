/**
 * One view of a command, as a React root (host.ts renders into it): after
 * each commit its instances become a tree (view/tree.ts), checked as the
 * shell will check it, and what changed is sent: the whole tree the first
 * time and whenever a patch would be as big, else the patch. At most one
 * send every `TREE_LIMITS.sendEveryMs`, so a burst of state is one message.
 *
 * A tree the shell would refuse is never sent: the view shows why instead
 * ("This view can't be shown"), and the reason goes to stderr, where
 * `dashi-applet dev` shows it.
 */

import type { ReactNode } from "react";
import ReactReconciler from "react-reconciler";
import { ConcurrentRoot } from "react-reconciler/constants";
import { ELEMENTS, TREE_LIMITS } from "../../view/elements.ts";
import { diffTrees, type PatchOp, type PropValue, parseTree, toWire, type ViewNode } from "../../view/tree.ts";
import { type Container, hostConfig, type Instance } from "./host.ts";

const reconciler = ReactReconciler(hostConfig);

export interface ViewOut {
  tree(root: ViewNode): void;
  patch(ops: PatchOp[]): void;
}

export interface ViewTimers {
  /** Runs `fn` after `ms`; what it returns cancels it. */
  set(fn: () => void, ms: number): () => void;
  now(): number;
}

export const realViewTimers: ViewTimers = {
  set: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
  now: () => performance.now(),
};

const ID = /[^A-Za-z0-9._:-]+/g;

/** A prop as the wire carries it, or undefined when it can't be one. */
function wireProp(value: unknown): PropValue | undefined {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.filter((each): each is string => typeof each === "string");
  return undefined;
}

/** What a view shows when its tree can't be sent: the reason, in the launcher's own empty view. */
export function problemTree(reason: string): ViewNode {
  return {
    t: "List",
    i: "problem",
    p: {},
    c: [{ t: "EmptyView", i: "problem:empty", p: { title: "This view can't be shown", description: reason.slice(0, 200) }, c: [] }],
  };
}

export class ViewRoot implements Container {
  readonly children: Instance[] = [];
  private ids = 0;
  private last: ViewNode | null = null;
  private byWireId = new Map<string, Instance>();
  private timer: (() => void) | null = null;
  private sentAt = Number.NEGATIVE_INFINITY;
  private readonly root: ReturnType<typeof reconciler.createContainer>;
  /** Whether it is the top of its command's views: only that one sends. */
  private shown = true;
  private gone = false;

  constructor(
    element: ReactNode,
    private readonly out: ViewOut,
    private readonly timers: ViewTimers = realViewTimers,
    private readonly report: (problem: string) => void = (problem) => console.error(`dashi launcher view: ${problem}`),
  ) {
    const fail = (error: unknown) => this.report(error instanceof Error ? error.message : String(error));
    this.root = reconciler.createContainer(this, ConcurrentRoot, null, false, null, "dashi-view", fail, fail, fail, () => {}, null);
    reconciler.updateContainer(element, this.root, null, null);
  }

  nextId(): string {
    return `n${++this.ids}`;
  }

  committed(): void {
    if (this.gone || !this.shown || this.timer !== null) return;
    const wait = Math.max(0, this.sentAt + TREE_LIMITS.sendEveryMs - this.timers.now());
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.flush();
    }, wait);
  }

  /** Under another view (pushed over it), it holds its changes; back on top, it sends itself whole. */
  setShown(shown: boolean): void {
    this.shown = shown;
    if (!shown) return;
    this.last = null;
    this.flush();
  }

  /** The instance the shell names by its node id. */
  instance(wireId: string): Instance | undefined {
    return this.byWireId.get(wireId);
  }

  /** The root element (List, Grid, Detail), for its callbacks. */
  get top(): Instance | undefined {
    return this.children[0];
  }

  unmount(): void {
    this.gone = true;
    this.timer?.();
    this.timer = null;
    reconciler.updateContainer(null, this.root, null, null);
  }

  /** Sends what changed since the last send. */
  flush(): void {
    if (this.gone || !this.shown) return;
    this.sentAt = this.timers.now();
    const ids = new Map<string, Instance>();
    const top = this.children[0];
    const built: ViewNode = top ? this.node(top, ids) : { t: "List", i: "loading", p: { loading: true }, c: [] };
    const checked = parseTree(toWire(built));
    const bytes = JSON.stringify(toWire(built)).length;
    let next: ViewNode = built;
    if ("error" in checked || bytes > TREE_LIMITS.bytes - 256) {
      const reason = "error" in checked ? checked.error : `the view is larger than ${TREE_LIMITS.bytes / 1024} KB: filter it, or page it with “more”`;
      this.report(reason);
      next = problemTree(reason);
    }
    this.byWireId = ids;
    const before = this.last;
    this.last = next;
    if (!before) return this.out.tree(next);
    const ops = diffTrees(before, next);
    if (ops.length === 0) return;
    if (JSON.stringify(ops).length * 2 > bytes) return this.out.tree(next);
    this.out.patch(ops);
  }

  private node(instance: Instance, ids: Map<string, Instance>): ViewNode {
    const specs: Readonly<Record<string, unknown>> = ELEMENTS[instance.type].props;
    const props: Record<string, PropValue> = {};
    for (const name of Object.keys(specs)) {
      const value = wireProp(instance.props[name]);
      if (value !== undefined) props[name] = value;
    }
    // An item the extension named keeps its name across renders and reorders; anything else, its instance's.
    const given = typeof instance.props.id === "string" ? `k:${instance.props.id.replace(ID, "-").slice(0, 120)}` : null;
    const wireId = given && !ids.has(given) ? given : instance.id;
    ids.set(wireId, instance);
    return { t: instance.type, i: wireId, p: props, c: instance.children.map((child) => this.node(child, ids)) };
  }
}
