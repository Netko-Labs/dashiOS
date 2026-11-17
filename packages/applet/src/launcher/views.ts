/**
 * An extension's side of version 6 (view/wire.ts): each `open` mounts the
 * command's view as a React root (lib/view-root.ts), and its tree goes to the
 * shell; events come back by node id and call the extension's own callbacks.
 * `push` mounts a view over it (the one under it holds its changes), Esc on
 * it (`pop`) unmounts it and the one under sends itself whole again.
 */

import { type ComponentType, createElement, isValidElement, type ReactNode } from "react";
import type { AccountGiven, ViewMessage, ViewShellMessage } from "../view/wire.ts";
import { ViewContext, type ViewContextValue } from "./hooks.ts";
import type { Instance } from "./lib/host.ts";
import { realViewTimers, ViewRoot, type ViewTimers } from "./lib/view-root.ts";

/** What a command's view is given: the words it was opened with and its arguments. */
export interface ViewLaunch {
  query: string;
  args: Record<string, string | number | boolean>;
}

export type ViewCommand = ComponentType<ViewLaunch>;

interface Open {
  seq: number;
  stack: ViewRoot[];
  preferences: Readonly<Record<string, string | boolean>>;
  accounts: Readonly<Record<string, AccountGiven>>;
  listeners: Set<() => void>;
}

const call = (fn: unknown, ...args: unknown[]): void => {
  if (typeof fn === "function") fn(...args);
};

export class LauncherViews {
  private readonly open = new Map<number, Open>();

  constructor(
    private readonly commands: Readonly<Record<string, ViewCommand>>,
    private readonly send: (message: ViewMessage) => void,
    private readonly timers: ViewTimers = realViewTimers,
  ) {}

  /** Whether `command` is one of these views. */
  has(command: string): boolean {
    return Object.hasOwn(this.commands, command);
  }

  /** A message from the shell. */
  receive(message: ViewShellMessage): void {
    if (message.type === "open") return this.start(message);
    const view = this.open.get(message.seq);
    if (!view) return;
    if (message.type === "prefs" || message.type === "accounts") {
      if (message.type === "prefs") view.preferences = message.preferences;
      else view.accounts = message.accounts;
      for (const listener of view.listeners) listener();
      return;
    }
    const top = view.stack.at(-1);
    switch (message.on) {
      case "close":
        return this.end(view);
      case "pop":
        return this.popView(view, false);
      case "search":
        return call(top?.top?.props.onSearchTextChange, message.text);
      case "more":
        return call(top?.top?.props.onLoadMore);
      case "select": {
        const item = top?.instance(message.node);
        return call(top?.top?.props.onSelectionChange, typeof item?.props.id === "string" ? item.props.id : null);
      }
      case "action":
        return this.action(view, top?.instance(message.node));
      case "change":
        // The launcher holds the value; the field's own callback hears it.
        return call(top?.instance(message.node)?.props.onChange, message.value);
      case "submit": {
        const action = top?.instance(message.node);
        if (action?.type !== "Action") return;
        return void Promise.resolve()
          .then(() => call(action.props.onSubmit, message.values))
          .catch((error: unknown) => this.send({ type: "toast", seq: view.seq, style: "failed", title: String(error instanceof Error ? error.message : error).slice(0, 80) || "Failed" }));
      }
    }
  }

  /** Every view goes (the shell went). */
  closeAll(): void {
    for (const view of [...this.open.values()]) this.end(view);
  }

  private start(message: Extract<ViewShellMessage, { type: "open" }>): void {
    const component = this.commands[message.command];
    if (!component) return;
    const view: Open = { seq: message.seq, stack: [], preferences: message.preferences, accounts: message.accounts, listeners: new Set() };
    this.open.set(message.seq, view);
    this.mount(view, createElement(component, { query: message.query, args: message.args }), "tree");
  }

  private context(view: Open): ViewContextValue {
    return {
      preferences: () => view.preferences,
      accounts: () => view.accounts,
      subscribe: (listener) => {
        view.listeners.add(listener);
        return () => view.listeners.delete(listener);
      },
      push: (element) => this.pushView(view, element),
      pop: () => this.popView(view, true),
      toast: (style, title) => this.send({ type: "toast", seq: view.seq, style, title: title.slice(0, 80) || " " }),
      close: () => {
        this.send({ type: "close", seq: view.seq });
        this.end(view);
      },
    };
  }

  private mount(view: Open, element: ReactNode, first: "tree" | "push"): void {
    let sent = false;
    const seq = view.seq;
    const root = new ViewRoot(
      createElement(ViewContext.Provider, { value: this.context(view) }, element),
      {
        // The first tree of a pushed view is its push; after that, as any.
        tree: (node) => {
          this.send({ type: !sent && first === "push" ? "push" : "tree", seq, root: node });
          sent = true;
        },
        patch: (ops) => this.send({ type: "patch", seq, ops }),
      },
      this.timers,
    );
    view.stack.push(root);
  }

  private pushView(view: Open, element: ReactNode): void {
    view.stack.at(-1)?.setShown(false);
    this.mount(view, element, "push");
  }

  /** The top view goes; `tell` when the extension popped it (Esc in the shell already did). */
  private popView(view: Open, tell: boolean): void {
    if (view.stack.length <= 1) return;
    view.stack.pop()?.unmount();
    if (tell) this.send({ type: "pop", seq: view.seq });
    view.stack.at(-1)?.setShown(true);
  }

  private action(view: Open, action: Instance | undefined): void {
    if (action?.type !== "Action") return;
    const pushes = action.props.pushes;
    if (action.props.kind === "push") return isValidElement(pushes) ? this.pushView(view, pushes) : undefined;
    // open, copy, paste and set ran in the shell; the extension hears it, and `run` is its own.
    call(action.props.onAction);
  }

  private end(view: Open): void {
    this.open.delete(view.seq);
    for (const root of view.stack.reverse()) root.unmount();
    view.stack = [];
  }
}
