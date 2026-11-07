/**
 * Agents from the launcher, wired to the shell (main.tsx starts it): the
 * service (agents/handoff/service.ts), its questions in the chip's panel
 * (agents/handoff/questions.ts), the panel itself (agents-panel.tsx), the
 * notifications, the launcher's side (launcher/agents/handoff-rows.ts), and
 * the context chips' source: the window in front and the selection when
 * the launcher opens.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import type { HarnessId } from "./agents/ask/answerer.ts";
import { NO_CONTEXT, type TaskContext } from "./agents/handoff/grants.ts";
import { attentionNotice, endedNotice, FOLLOW_UP, logText, SHOW } from "./agents/handoff/notices.ts";
import { routedUi } from "./agents/handoff/questions.ts";
import { type Handoff, type HandoffOptions, startHandoff } from "./agents/handoff/service.ts";
import { hostOf } from "./agents/handoff/words.ts";
import type { AgentStore, AgentUi } from "./agents/presence.ts";
import { AgentsPanel, type PanelActions } from "./agents-panel.tsx";
import type { HandoffSnapshot, LauncherHandoff } from "./launcher/agents/handoff-rows.ts";
import type { Store } from "./launcher/host.ts";
import type { MenuController } from "./menus/controller.ts";
import { type NotificationStore, SHELL_SENDER } from "./notifications/store.ts";

/** The popover's layer: a yes in the panel counts only if the person pressed it there (agents/person.ts). */
export const PANEL_LAYER = "dashi.popover";

export interface HandoffShellDeps extends Omit<HandoffOptions, "ended"> {
  agents: Pick<AgentStore, "getSnapshot">;
  notifications: NotificationStore;
  /** The menus' controller, once it exists (the panel is a popover). */
  menus(): MenuController | null;
  /** Whether the person's own hands pressed on `layer` just now. */
  personPressed(layer: string): Promise<boolean>;
  /** Opens a file in its app (Show: the whole log). */
  openFile(path: string): void;
  /** Settings › Agents. */
  openSettings(): void;
  /** Terminal, to sign a harness in. */
  openTerminal(harness: HarnessId): void;
  /** The launcher, talking to a run (Follow up). */
  talkTo(run: string): void;
}

export interface HandoffShell {
  service: Handoff;
  /** The agents server's UI: a run's questions in the panel. */
  ui(sheets: AgentUi): AgentUi;
  launcher: LauncherHandoff;
  panel(props: { right: number; focus: string | null; close: () => void }): ReactElement;
  /** The panel, on a run's card. */
  open(run: string | null): void;
  close(): void;
}

/** A store of the launcher's snapshot, made again only when the runs or the harnesses change. */
function snapshotStore(service: Handoff): Store<HandoffSnapshot> {
  let snapshot: HandoffSnapshot = { harnesses: service.harnesses(), runs: service.runs.getSnapshot() };
  return {
    subscribe(listener) {
      const offs = [service.runs.subscribe(listener), service.subscribeHarnesses(listener)];
      return () => {
        for (const off of offs) off();
      };
    },
    getSnapshot() {
      const runs = service.runs.getSnapshot();
      const harnesses = service.harnesses();
      if (snapshot.runs !== runs || snapshot.harnesses !== harnesses) snapshot = { harnesses, runs };
      return snapshot;
    },
  };
}

export function startHandoffShell(deps: HandoffShellDeps): HandoffShell {
  /** Notification id → its run. */
  const notices = new Map<number, string>();
  const service = startHandoff({
    ...deps,
    ended(run) {
      const notice = endedNotice(run);
      if (notice) notices.set(deps.notifications.notify(notice, 0, SHELL_SENDER), run.id);
    },
  });
  const offNotices = deps.notifications.onEvent((event) => {
    if (event.type !== "action") return;
    const run = notices.get(event.id);
    if (!run) return;
    if (event.key === SHOW || event.key === "default") open(run);
    if (event.key === FOLLOW_UP) deps.talkTo(run);
  });

  const panelOpen = () => deps.menus()?.getSnapshot().popover?.kind === "agents";
  function open(run: string | null): void {
    // Under the menu bar's right end when the chip didn't say where it is.
    void deps.menus()?.toggleAgents("Desktop", 0, run);
  }

  const actions: PanelActions = {
    answer(run, question, choice) {
      // A no (and "Other login…") always counts; a yes only from the person's own press, as on a sheet.
      if (choice === "deny" || choice === "no" || choice === "other") return void service.runs.answer(run, question, choice);
      void deps.personPressed(PANEL_LAYER).then((person) => {
        if (person) service.runs.answer(run, question, choice);
        else console.error("dashi-shell: an answer in the agents' panel did not come from the person; it was ignored");
      });
    },
    stop: (run) => service.stop(run),
    show(run) {
      const view = service.runs.get(run);
      const runtime = process.env.XDG_RUNTIME_DIR;
      if (!view || !runtime) return;
      const dir = join(runtime, "dashi-agents", run);
      const path = join(dir, "log.txt");
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(path, logText(view), { mode: 0o600 });
        deps.openFile(path);
        deps.menus()?.close();
      } catch (error) {
        console.error("dashi-shell: couldn't show an agent's log:", error);
      }
    },
    undo: (run, index) => void service.undo(run, index),
  };

  const store = snapshotStore(service);
  const launcher: LauncherHandoff = {
    ...store,
    needsCard: (context) => service.needsCard(context),
    start(input, watch) {
      void service.start(input).then((id) => {
        if (watch && id) open(id);
      });
    },
    open,
    tell: (run, text) => service.tell(run, text),
    stop: (run) => service.stop(run),
    settings: deps.openSettings,
    signIn: deps.openTerminal,
  };

  return {
    service,
    ui: (sheets) =>
      routedUi(sheets, {
        taskOf: (agent) => deps.agents.getSnapshot().find((each) => each.id === agent)?.task ?? null,
        runs: service.runs,
        panelOpen,
        onPanelClosed(listener) {
          let was = panelOpen();
          return (
            deps.menus()?.subscribe(() => {
              const now = panelOpen();
              if (was && !now) listener();
              was = now;
            }) ?? (() => {})
          );
        },
        attention(run, question) {
          notices.set(deps.notifications.notify(attentionNotice(run, question), 0, SHELL_SENDER), run.id);
        },
      }),
    launcher,
    panel: ({ right, focus, close }) => <AgentsPanel runs={service.runs} right={right} focus={focus} actions={actions} onClose={close} />,
    open,
    close() {
      offNotices();
      service.close();
    },
  };
}

/** A store for the context chips, filled in as the launcher opens. */
export class ContextSource implements Store<TaskContext> {
  private context: TaskContext = NO_CONTEXT;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TaskContext => this.context;

  set(context: TaskContext): void {
    this.context = context;
    for (const listener of this.listeners) listener();
  }
}

/** The most of a selection the chips take. */
const SELECTION_BYTES = 8 * 1024;

/**
 * What the chips offer as the launcher opens: the focused window (its app's
 * name, title, and in Helium the page's address through Dashi's extension),
 * and the primary selection's text when there is some.
 */
export async function readContext(deps: {
  window(): Promise<{ id: number; app: string; title: string } | null>;
  page(): Promise<{ url: string; title: string } | null>;
  selection(): Promise<string | null>;
}): Promise<TaskContext> {
  const [window, selection] = await Promise.all([deps.window().catch(() => null), deps.selection().catch(() => null)]);
  const browser = window && /helium|chrom/i.test(window.app) ? await deps.page().catch(() => null) : null;
  const url = browser?.url && /^https?:/.test(browser.url) ? browser.url : null;
  const text = selection?.trim() ? selection.slice(0, SELECTION_BYTES) : null;
  return {
    window: window ? { id: window.id, app: window.app, title: window.title, site: url ? hostOf(url) : null, url } : null,
    selection: text,
  };
}

/** The primary selection's text through wl-paste (the shell's data-control client), or null. */
export async function primarySelection(): Promise<string | null> {
  const paste = Bun.which("wl-paste");
  if (!paste) return null;
  try {
    const child = Bun.spawn([paste, "--primary", "--no-newline", "--type", "text/plain"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => child.kill(), 400);
    const text = await new Response(child.stdout).text();
    clearTimeout(timer);
    return (await child.exited) === 0 && text.length <= SELECTION_BYTES ? text : null;
  } catch {
    return null;
  }
}
