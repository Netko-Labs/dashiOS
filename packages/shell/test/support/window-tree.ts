/**
 * A made-up AT-SPI app for the window tree's tests: nodes answer the calls
 * window-tree/lib/bus.ts and do.ts make (Properties, interfaces, actions,
 * text, extents) from a plain description, and record what was asked of
 * them, so a test can say a password's text was never read.
 */

import type { A11yNode, Rect } from "../../src/agents/atspi/index.ts";
import { R, S } from "../../src/agents/window-tree/lib/roles.ts";

export interface Spec {
  role: number;
  name?: string;
  states?: readonly number[];
  actions?: readonly string[];
  text?: string;
  value?: { now: number; min: number; max: number; step: number };
  interfaces?: readonly string[];
  attributes?: Record<string, string>;
  rect?: Rect;
  children?: Spec[];
  id?: string;
}

/** GetState's two words with these bits set. */
export function bits(...states: number[]): number[] {
  const words = [0, 0];
  for (const state of states) words[state >> 5] = ((words[state >> 5] ?? 0) | (1 << (state & 31))) >>> 0;
  return words;
}

/** What a usual, enabled, showing element has. */
export const LIVE = [S.ENABLED, S.SENSITIVE, S.VISIBLE, S.SHOWING];

export class FakeApp {
  readonly asked: string[] = [];
  readonly nodes = new Map<string, FakeNode>();
  private next = 0;
  gone = new Set<string>();
  root: FakeNode;
  constructor(frame: Spec) {
    this.root = this.make({ role: R.APPLICATION, children: [frame] });
  }
  make(spec: Spec): FakeNode {
    const path = `/org/a11y/atspi/accessible/${this.next++}`;
    const node = new FakeNode(this, path, spec, spec.children?.map((child) => this.make(child)) ?? []);
    this.nodes.set(path, node);
    return node;
  }
  /** The node first named `name`. */
  named(name: string): FakeNode {
    const found = [...this.nodes.values()].find((node) => node.spec.name === name);
    if (!found) throw new Error(`no node ${name}`);
    return found;
  }
}

export class FakeNode implements A11yNode {
  constructor(
    readonly app: FakeApp,
    readonly path: string,
    readonly spec: Spec,
    readonly kids: FakeNode[],
  ) {}
  get key(): string {
    return `:1.9${this.path}`;
  }
  private alive(): void {
    if (this.app.gone.has(this.path)) throw new Error("org.freedesktop.DBus.Error.UnknownObject");
  }
  async role(): Promise<number> {
    this.alive();
    return this.spec.role;
  }
  async states(): Promise<readonly number[]> {
    this.alive();
    return bits(...(this.spec.states ?? LIVE));
  }
  async children(): Promise<A11yNode[]> {
    return this.kids.filter((kid) => !this.app.gone.has(kid.path));
  }
  async extents(): Promise<Rect | null> {
    return this.spec.rect ?? null;
  }
  async url(): Promise<string | null> {
    return null;
  }
  at(path: string): A11yNode {
    return this.app.nodes.get(path) ?? new FakeNode(this.app, path, { role: -1 }, []);
  }
  private interfaces(): string[] {
    const own = [...(this.spec.interfaces ?? [])];
    if (this.spec.actions) own.push("Action");
    if (this.spec.text !== undefined) own.push("Text");
    if (this.spec.value) own.push("Value");
    if (this.spec.rect) own.push("Component");
    return own.map((name) => `org.a11y.atspi.${name}`);
  }
  async ask(iface: string, member: string, _signature?: string, body?: unknown[]): Promise<unknown> {
    this.alive();
    this.app.asked.push(`${this.spec.name ?? this.spec.role} ${iface.replace("org.a11y.atspi.", "")}.${member}${body ? ` ${JSON.stringify(body)}` : ""}`);
    const of = String(body?.[0] ?? "").replace("org.a11y.atspi.", "");
    if (member === "GetAll" && of === "Accessible")
      return new Map<string, unknown>([
        ["Name", this.spec.name ?? ""],
        ["Description", ""],
        ["ChildCount", this.kids.length],
        ["AccessibleId", this.spec.id ?? ""],
      ]);
    if (member === "GetAll" && of === "Text")
      return new Map<string, unknown>([
        ["CharacterCount", this.spec.text?.length ?? 0],
        ["CaretOffset", 2],
      ]);
    if (member === "GetAll" && of === "Value")
      return new Map<string, unknown>(
        Object.entries({
          CurrentValue: this.spec.value?.now,
          MinimumValue: this.spec.value?.min,
          MaximumValue: this.spec.value?.max,
          MinimumIncrement: this.spec.value?.step,
        }),
      );
    if (member === "Get") return this.spec.name ?? "";
    if (member === "GetInterfaces") return this.interfaces();
    if (member === "GetAttributes") return new Map(Object.entries(this.spec.attributes ?? {}));
    if (member === "GetActions") return (this.spec.actions ?? []).map((name) => [name, "", ""]);
    if (member === "GetText") return this.spec.text ?? "";
    if (member === "GetExtents") return this.spec.rect ? [this.spec.rect.x, this.spec.rect.y, this.spec.rect.width, this.spec.rect.height] : null;
    if (member === "DoAction" || member === "GrabFocus" || member === "SetTextContents" || member === "ScrollTo" || member === "Set") return true;
    return null;
  }
}

/** A bus with one app, running as `pid`. */
export const fakeBus = (app: FakeApp, pid = 40) => ({
  appFor: async (asked: number) => (asked === pid ? app.root : null),
});
