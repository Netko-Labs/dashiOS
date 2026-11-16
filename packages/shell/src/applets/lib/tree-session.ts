/**
 * One open view of an extension's command (protocol 6), as the launcher
 * reaches it (actions/types.ts `TreeView`): the trees it sent, a stack when
 * it pushed one over another, its last toast, and the events it is sent.
 * The shell checks every tree and patch (@dashi/applet `parseTree`,
 * `applyPatch`) before the launcher draws a node of it; a patch that would
 * break the tree is refused and the view stays as it was.
 *
 * `open`, `copy`, `paste` and `set` actions run here, in the shell, never in
 * the extension: it hears that they ran.
 */

import { join } from "node:path";
import {
  applyPatch,
  findNode,
  type Manifest,
  type PreferenceValue,
  textProp,
  type ViewEvent,
  type ViewMessage,
  type ViewNode,
  type ViewShellMessage,
} from "@dashi/applet";
import type { Outcome, TreeActed, TreeSnapshot, TreeView } from "../../actions/index.ts";

export interface SessionDeps {
  send(message: ViewShellMessage): void;
  open(target: string): Promise<Outcome>;
  copy(text: string): Promise<boolean>;
  /** Types it into the window that was in front of the launcher; false when it can't (it is copied instead). */
  paste?(text: string): Promise<boolean>;
  setPreference(manifest: Manifest, name: string, value: PreferenceValue): Promise<boolean>;
  preferences(manifest: Manifest): Promise<Record<string, PreferenceValue>>;
  /** The view closed (the launcher left it, or the extension said close). */
  closed(session: TreeSession): void;
  now(): number;
}

export class TreeSession implements TreeView {
  readonly from: string;
  readonly icon?: string;
  readonly dir: string | null;
  private state: TreeSnapshot;
  private readonly listeners = new Set<() => void>();
  /** Whether the extension has heard `open`: until it connects, events wait. */
  private sent = false;

  constructor(
    readonly seq: number,
    readonly manifest: Manifest,
    /** The installed package's folder (its icon and images), or null for one in development. */
    dir: string | null,
    private readonly deps: SessionDeps,
  ) {
    this.from = manifest.name;
    this.dir = dir;
    if (dir && manifest.icon) this.icon = join(dir, manifest.icon);
    this.state = { stack: [], phase: "starting", since: deps.now() };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): TreeSnapshot => this.state;

  private set(next: Partial<TreeSnapshot>): void {
    this.state = { ...this.state, ...next };
    for (const listener of [...this.listeners]) listener();
  }

  /** The extension is connected: it is sent `open`. */
  started(command: string, args: Record<string, string | number | boolean>, preferences: Record<string, PreferenceValue>): void {
    this.sent = true;
    this.deps.send({ type: "open", seq: this.seq, command, args, query: "", preferences });
  }

  /** Time passed: the launcher looks again ("Loading…" after 300 ms). */
  tick(): void {
    if (this.state.phase === "starting") this.set({});
  }

  /** It couldn't start, or stopped, or didn't answer. */
  fail(error: string): void {
    if (this.state.phase === "closed") return;
    this.set({ phase: "failed", error });
  }

  /** A message about this view; a refusal's words, or null. */
  receive(message: ViewMessage): string | null {
    if (this.state.phase === "closed") return null;
    const { stack } = this.state;
    switch (message.type) {
      case "tree":
        this.set({ stack: [...stack.slice(0, -1), message.root], phase: "shown" });
        return null;
      case "push":
        this.set({ stack: [...stack, message.root], phase: "shown" });
        return null;
      case "pop":
        if (stack.length > 1) this.set({ stack: stack.slice(0, -1) });
        return null;
      case "patch": {
        const top = stack.at(-1);
        if (!top) return "patch: there is no tree yet";
        const next = applyPatch(top, message.ops);
        if ("error" in next) return `patch: ${next.error}`;
        this.set({ stack: [...stack.slice(0, -1), next] });
        return null;
      }
      case "toast":
        this.set({ toast: { style: message.style, title: message.title } });
        return null;
      case "close":
        this.end(false);
        return null;
    }
  }

  private event(event: ViewEvent): void {
    if (this.sent && this.state.phase !== "closed") this.deps.send({ type: "event", seq: this.seq, ...event });
  }

  search = (text: string): void => this.event({ on: "search", text });
  select = (node: string): void => this.event({ on: "select", node });
  more = (): void => this.event({ on: "more" });

  act = async (node: string): Promise<TreeActed> => {
    const top = this.state.stack.at(-1);
    const action = top ? findNode(top, node) : undefined;
    if (action?.t !== "Action") return { kind: "failed", error: "That action is gone." };
    const done = await this.builtIn(action);
    this.event({ on: "action", node });
    return done;
  };

  private async builtIn(action: ViewNode): Promise<TreeActed> {
    const target = textProp(action, "target") ?? "";
    const content = textProp(action, "content") ?? "";
    switch (textProp(action, "kind")) {
      case "open": {
        const outcome = await this.deps.open(target);
        return outcome.ok ? { kind: "done", close: true } : { kind: "failed", error: outcome.error };
      }
      case "copy":
        return (await this.deps.copy(content)) ? { kind: "done", notice: "Copied" } : { kind: "failed", error: "Couldn't copy" };
      case "paste":
        if (this.deps.paste && (await this.deps.paste(content))) return { kind: "done", close: true };
        return (await this.deps.copy(content)) ? { kind: "done", notice: "Copied: paste it with ❖V" } : { kind: "failed", error: "Couldn't copy" };
      case "set": {
        const preference = this.manifest.preferences.find((each) => each.name === target);
        if (!preference) return { kind: "failed", error: `${this.from} has no preference “${target}”` };
        return { kind: "ask", name: preference.name, title: preference.title, secret: preference.type === "secret" };
      }
      default:
        return { kind: "done" };
    }
  }

  setPreference = async (name: string, value: string): Promise<boolean> => {
    const kept = await this.deps.setPreference(this.manifest, name, value.trim());
    if (kept && this.sent && this.state.phase !== "closed")
      this.deps.send({ type: "prefs", seq: this.seq, preferences: await this.deps.preferences(this.manifest) });
    return kept;
  };

  back = (): boolean => {
    if (this.state.stack.length <= 1) return false;
    this.set({ stack: this.state.stack.slice(0, -1) });
    this.event({ on: "pop" });
    return true;
  };

  close = (): void => this.end(true);

  private end(tell: boolean): void {
    if (this.state.phase === "closed") return;
    if (tell) this.event({ on: "close" });
    this.set({ phase: "closed" });
    this.deps.closed(this);
  }
}
