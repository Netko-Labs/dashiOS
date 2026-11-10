/**
 * Agents from the launcher, wired to the shell (boot/agents.ts starts it): the
 * service (agents/handoff/service.ts), its questions in the agents' panel
 * (agents/handoff/questions.ts), the panel itself (agents-panel.tsx), the
 * notifications, the launcher's side (launcher/lib/agents/handoff-rows.ts), and
 * the context chips' source: the window in front and the selection when
 * the launcher opens.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import {
  type AgentStore,
  type AgentUi,
  attentionNotice,
  endedNotice,
  FOLLOW_UP,
  type Handoff,
  type HandoffOptions,
  type HarnessId,
  hostOf,
  isWorking,
  logText,
  NO_CONTEXT,
  routedUi,
  SHOW,
  startHandoff,
  type TaskContext,
} from "./agents/index.ts";
import { AgentsPanel, type PanelActions } from "./agents-panel.tsx";
import type { HandoffSnapshot, LauncherHandoff, Store } from "./launcher/index.ts";
import type { MenuController } from "./menus/index.ts";
import { type NotificationStore, SHELL_SENDER } from "./notifications/index.ts";

/** The popover's layer: a yes in the panel counts only if the person pressed it there (agents/person.ts). */
export const PANEL_LAYER = "dashi.popover";

export interface HandoffShellDeps extends Omit<HandoffOptions, "ended"> {
  agents: Pick<AgentStore, "getSnapshot" | "subscribe">;
  /** Cut a connected agent off (the panel's Stop on its row), and every one (Stop all); the StoppedNote follows. */
  stopAgent(id: number): void;
  stopAgents(): void;
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

/** The agents' panel's buttons: answers, Stop, Show, Undo, and the Stop all of ⌃❖Esc. */
function panelActions(service: Handoff, deps: HandoffShellDeps): PanelActions {
  return {
    answer(run, question, choice) {
      // Answered, the panel goes as a sheet does: what Dashi types next (a login, a code) goes to the person's
      // seat, so the keyboard must be back on their window, not on this popover. The answer is recorded
      // first, so the panel closing doesn't put the sheet up again (questions.ts); the agent hears it only
      // after this returns, with the panel gone. "Other login…" asks again, so the panel stays.
      const answer = () => {
        service.runs.answer(run, question, choice);
        if (choice !== "other") deps.menus()?.close();
      };
      // A no (and "Other login…") always counts; a yes only from the person's own press, as on a sheet.
      if (choice === "deny" || choice === "no" || choice === "other") return answer();
      void deps.personPressed(PANEL_LAYER).then((person) => {
        if (person) answer();
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
    stopAgent: (id) => deps.stopAgent(id),
    stopAll() {
      // As ⌃❖Esc: every connection, and every run still working (its connection may be between turns).
      for (const run of service.runs.getSnapshot()) if (isWorking(run)) service.stop(run.id);
      deps.stopAgents();
      deps.menus()?.close();
    },
  };
}

/** The launcher's side: its snapshot and the buttons that start, open, tell and stop a run. */
function launcherHandoff(service: Handoff, deps: HandoffShellDeps, open: (run: string | null) => void): LauncherHandoff {
  return {
    ...snapshotStore(service),
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
}

/** The agents server's UI: a run's questions go to the panel while it is open, else to the sheets. */
function questionsUi(sheets: AgentUi, service: Handoff, deps: HandoffShellDeps, notices: Map<number, string>): AgentUi {
  const panelOpen = () => deps.menus()?.getSnapshot().popover?.kind === "agents";
  return routedUi(sheets, {
    taskOf: (agent) => deps.agents.getSnapshot().find((each) => each.id === agent)?.task ?? null,
    runs: service.runs,
    panelOpen,
    onPanel(listener) {
      let was = panelOpen();
      return (
        deps.menus()?.subscribe(() => {
          const now = panelOpen();
          if (was !== now) listener(now);
          was = now;
        }) ?? (() => {})
      );
    },
    attention(run, question) {
      notices.set(deps.notifications.notify(attentionNotice(run, question), 0, SHELL_SENDER), run.id);
    },
  });
}

export function startHandoffShell(deps: HandoffShellDeps): HandoffShell {
  /** Notification id → its run. */
  const notices = new Map<number, string>();
  const service = startHandoff({
    ...deps,
    // A run stuck signed out offers Sign In…, which opens Terminal as the launcher's does.
    signIn: deps.openTerminal,
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

  function open(run: string | null): void {
    // Under the menu bar's right end when the mark didn't say where it is.
    void deps.menus()?.toggleAgents("Desktop", 0, run);
  }

  const actions = panelActions(service, deps);
  return {
    service,
    ui: (sheets) => questionsUi(sheets, service, deps, notices),
    launcher: launcherHandoff(service, deps, open),
    panel: ({ right, focus, close }) => <AgentsPanel runs={service.runs} agents={deps.agents} right={right} focus={focus} actions={actions} onClose={close} />,
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

/** Whether a window is Helium's (or another Chromium's), which Dashi names "Browser": by its app id, else its name. */
const isBrowser = (window: { app: string; appId?: string }): boolean => /helium|chrom/i.test(window.appId ?? "") || /helium|chrom/i.test(window.app);

/**
 * What the chips offer as the launcher opens: the focused window (its app's
 * name, title, and in Helium the page's address through Dashi's extension),
 * and the primary selection's text when there is some.
 */
export async function readContext(deps: {
  window(): Promise<{ id: number; app: string; appId?: string; title: string } | null>;
  page(): Promise<{ url: string; title: string } | null>;
  selection(): Promise<string | null>;
}): Promise<TaskContext> {
  const [window, selection] = await Promise.all([deps.window().catch(() => null), deps.selection().catch(() => null)]);
  const browser = window && isBrowser(window) ? await deps.page().catch(() => null) : null;
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
