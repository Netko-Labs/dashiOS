/** The launcher's commands for an applet made with `defineApplet` (define.ts): runs, rows, and views. */

import { createElement, useSyncExternalStore } from "react";
import type { AppletsClient } from "./client.ts";
import type { CommandRun, PopoverPlacement } from "./client-types.ts";
import type { CommandResult } from "./commands.ts";
import type { AppletHandle, Args, CommandAnswer, CommandDefinition } from "./define-types.ts";
import type { Manifest } from "./manifest.ts";
import { type OpenPopover, openPopoverWindow } from "./popover.tsx";
import type { WarmHost } from "./warm-host.ts";

const answerOf = (answer: CommandAnswer): CommandResult => (typeof answer === "string" ? { text: answer } : answer);
const errorOf = (error: unknown): CommandResult => ({ error: (error instanceof Error ? error.message : String(error)).slice(0, 200) || "It failed." });

type ViewComponent<S> = NonNullable<CommandDefinition<S>["view"]>["component"];

/** A command's view, drawn again whenever the applet's state changes. */
function liveView<S>(component: ViewComponent<S>, handle: AppletHandle<S>, listeners: Set<() => void>, args: Args, close: () => void) {
  return (): ReturnType<typeof createElement> => {
    const now = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => handle.state,
    );
    return createElement(component, { state: now, set: handle.set, args, close });
  };
}

/** The launcher's runs, answered by `commands` (one view open at a time, drawn as a popover is). */
export function commandHandlers<S>(
  commands: Record<string, CommandDefinition<S>>,
  handle: AppletHandle<S>,
  manifest: Manifest | null,
  title: string,
  listeners: Set<() => void>,
  warm: WarmHost | null,
): Parameters<AppletsClient["onCommands"]>[0] {
  const { client } = handle;
  let view: { seq: number; open: OpenPopover | null; args: Args; spec: NonNullable<CommandDefinition<S>["view"]> } | null = null;
  const closeView = (): void => {
    const open = view?.open;
    view = null;
    open?.close();
  };
  const settle = (seq: number, work: () => CommandAnswer | Promise<CommandAnswer>): void => {
    Promise.resolve()
      .then(work)
      .then(
        (answer) => client.result(seq, answerOf(answer)),
        (error) => client.result(seq, errorOf(error)),
      );
  };
  return {
    onRun: (run: CommandRun) => {
      const command = Object.hasOwn(commands, run.command) ? commands[run.command] : undefined;
      if (!command) return client.result(run.seq, { error: `${title} has no command “${run.command}”.` });
      if (run.item !== undefined) {
        const item = run.item;
        return settle(run.seq, () => command.choose?.(item, run.args, handle) ?? { error: "Nothing happens when it is chosen." });
      }
      if (run.query !== undefined) {
        const query = run.query;
        Promise.resolve()
          .then(() => command.items?.(query, run.args, handle) ?? [])
          .then(
            (rows) => client.items(run.seq, rows),
            (error) => client.result(run.seq, errorOf(error)),
          );
        return;
      }
      if (command.view) {
        closeView();
        view = { seq: run.seq, open: null, args: run.args, spec: command.view };
        return client.requestView(run.seq, command.view.height);
      }
      settle(run.seq, () => command.run?.(run.args, handle) ?? { error: "It does nothing yet." });
    },
    onView: (seq, placement: PopoverPlacement) => {
      const current = view;
      if (current?.seq !== seq || current.open) return;
      const close = (): void => client.dismissView(seq);
      current.open = openPopoverWindow({
        appId: manifest?.id ?? "applet.view",
        title,
        placement,
        element: createElement(liveView(current.spec.component, handle, listeners, current.args, close)),
        warm,
        // The launcher keeps the keyboard, and closes the view on Esc.
        keyboard: "on-demand",
        onClosed: () => {
          if (view?.seq === seq) view = null;
          close();
        },
      });
    },
    onViewDismiss: (seq) => {
      if (view?.seq === seq) closeView();
    },
  };
}
