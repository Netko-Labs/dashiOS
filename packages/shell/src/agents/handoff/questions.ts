/**
 * An agent from the launcher asks its questions in the menu bar's panel, not
 * in sheets over the person's work (docs/actions.md, "Agents from the
 * launcher"): which login (Allow for this task, Once, Other login…, Don't),
 * a website, a hand-over (do it, then Done), another permission, or one
 * action. The question goes on the run's card (store.ts) and the chip turns
 * amber. While the panel is closed the existing sheet shows as well, and a
 * notification says so; whichever the person answers first counts, and the
 * other comes down. Payments keep dashi-secretd's own fingerprint or
 * password sheet: that is the proof.
 *
 * Any other agent's questions go to the sheets as before.
 */

import type { AgentUi, Allow, Answer, SignInAsk, SignInChoice } from "../presence.ts";
import { DENY } from "../sheet-queue.ts";
import type { AgentRuns, RunQuestion, RunView } from "./store.ts";

export interface QuestionDeps {
  /** The run an MCP connection belongs to (its sandbox's scope), or null. */
  taskOf(agent: number): string | null;
  runs: AgentRuns;
  /** Whether the panel is on screen now. */
  panelOpen(): boolean;
  /** Told when the panel closes. */
  onPanelClosed(listener: () => void): () => void;
  /** A question went up while the panel was closed: the notification. */
  attention(run: RunView, question: RunQuestion): void;
}

type Asked = Omit<RunQuestion, "id">;

/** The panel's question for a login: the first login, or the one "Other login…" moved to. */
export function signInQuestion(ask: SignInAsk, index: number): Asked {
  const login = ask.logins[index % Math.max(1, ask.logins.length)];
  const site = ask.summary.replace(/^sign in to /, "");
  return {
    kind: "sign-in",
    title: `Use your ${site} login?`,
    detail: login ? `${login.source} · ${login.account}` : "No saved login",
    choices: [
      { id: "task", label: "Allow for this task", primary: true },
      { id: "once", label: "Once" },
      ...(ask.logins.length > 1 ? [{ id: "other", label: "Other login…" }] : []),
      { id: "deny", label: "Don't", danger: true },
    ],
    needs: "needs your OK to sign in",
  };
}

export const siteQuestion = (site: string): Asked => ({
  kind: "site",
  title: `Use ${site}?`,
  detail: "It reads its pages as text and clicks and fills in on them. Never a password, card or code field.",
  choices: [
    { id: "once", label: "Allow", primary: true },
    { id: "always", label: "Always" },
    { id: "deny", label: "Don't", danger: true },
  ],
  needs: `needs your OK to use ${site}`,
});

export const turnQuestion = (reason: string): Asked => ({
  kind: "turn",
  title: `Your turn: ${reason}`,
  detail: "Do it in the window it brought forward, then Done.",
  choices: [{ id: "done", label: "Done", primary: true }],
  needs: `needs you: ${reason}`,
});

/**
 * The AgentUi the agents server uses: a task's questions in the panel (and
 * the sheets while it is closed), everyone else's in the sheets.
 */
export function routedUi(ui: AgentUi, deps: QuestionDeps): AgentUi {
  /**
   * Ask `asked` on run `task`'s card, and the sheet while the panel is
   * closed (or once it closes); the first answer counts. `fromPanel` maps a
   * panel choice to the answer (null: ask again, in `again`).
   */
  async function both<T>(
    task: string,
    asked: Asked,
    sheet: (signal: AbortSignal) => Promise<T>,
    fromPanel: (choice: string) => T | "again",
    refused: T,
    signal: AbortSignal | undefined,
    again?: () => Asked,
  ): Promise<T> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let shown: Promise<T> | null = null;
    let current = deps.runs.ask(task, asked);
    let resolveSheet: (value: T) => void = () => {};
    const fromSheet = new Promise<T>((resolve) => {
      resolveSheet = resolve;
    });
    const showSheet = () => {
      if (shown || controller.signal.aborted) return;
      shown = sheet(controller.signal);
      void shown.then((value) => {
        if (!controller.signal.aborted) resolveSheet(value);
      });
      const run = deps.runs.get(task);
      if (run) deps.attention(run, current.question);
    };
    const offClosed = deps.onPanelClosed(showSheet);
    if (!deps.panelOpen()) showSheet();
    try {
      for (;;) {
        const won = await Promise.race([current.answer.then((choice) => ({ panel: choice })), fromSheet.then((value) => ({ sheet: value }))]);
        if ("sheet" in won) {
          deps.runs.answer(task, current.question.id, null);
          return won.sheet;
        }
        if (won.panel === null) {
          // Taken back: the run ended, or the agent gave up on the call.
          if (controller.signal.aborted || !deps.runs.get(task) || deps.runs.get(task)?.ended !== null) return refused;
          return shown ? await fromSheet : refused;
        }
        const value = fromPanel(won.panel);
        if (value !== "again") return value;
        current = deps.runs.ask(task, again?.() ?? asked);
      }
    } finally {
      offClosed();
      signal?.removeEventListener("abort", onAbort);
      deps.runs.answer(task, current.question.id, null);
      controller.abort();
    }
  }

  return {
    ...ui,
    ask(ask, signal) {
      const task = deps.taskOf(ask.agent);
      if (!task) return ui.ask(ask, signal);
      const needed = ask.scopes.filter((scope) => scope.needed);
      const words = needed.map((scope) => scope.label.toLowerCase()).join(", ");
      const asked: Asked = {
        kind: "scopes",
        title: `Let it ${words || "do more"}?`,
        detail: needed[0]?.detail ?? "",
        choices: [
          { id: "once", label: "Allow for this task", primary: true },
          { id: "deny", label: "Don't", danger: true },
        ],
        needs: "needs your OK",
      };
      return both<Answer>(
        task,
        asked,
        (inner) => ui.ask(ask, inner),
        (choice) => (choice === "once" ? { allow: "once", scopes: needed.map((scope) => scope.id) } : DENY),
        DENY,
        signal,
      );
    },
    confirm(confirm, signal) {
      const task = deps.taskOf(confirm.agent);
      if (!task) return ui.confirm(confirm, signal);
      const asked: Asked = {
        kind: "confirm",
        title: `${confirm.action}?`,
        detail: confirm.detail,
        choices: [
          { id: "yes", label: confirm.action, ...(confirm.danger ? { danger: true as const } : { primary: true as const }) },
          { id: "no", label: "Cancel" },
        ],
        needs: `needs your OK to ${confirm.summary}`,
      };
      return both<boolean>(
        task,
        asked,
        (inner) => ui.confirm(confirm, inner),
        (choice) => choice === "yes",
        false,
        signal,
      );
    },
    allowSite(ask, signal) {
      const task = deps.taskOf(ask.agent);
      if (!task) return ui.allowSite(ask, signal);
      return both<Allow>(
        task,
        siteQuestion(ask.site),
        (inner) => ui.allowSite(ask, inner),
        (choice) => (choice === "once" || choice === "always" ? choice : "deny"),
        "deny",
        signal,
      );
    },
    signIn(ask, signal) {
      const task = deps.taskOf(ask.agent);
      if (!task) return ui.signIn(ask, signal);
      let index = 0;
      const login = () => ask.logins[index % Math.max(1, ask.logins.length)]?.key ?? null;
      return both<SignInChoice>(
        task,
        signInQuestion(ask, index),
        (inner) => ui.signIn(ask, inner),
        (choice) => {
          if (choice === "other") {
            index += 1;
            return "again";
          }
          const key = login();
          if ((choice === "task" || choice === "once") && key) return { allow: choice, login: key };
          return { allow: "deny", login: null };
        },
        { allow: "deny", login: null },
        signal,
        () => signInQuestion(ask, index),
      );
    },
    turn(turn, signal) {
      const task = deps.taskOf(turn.agent);
      if (!task) return ui.turn(turn, signal);
      // The banner always shows (the window comes forward with it): Done there or in the panel.
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const banner = ui.turn(turn, controller.signal);
      const { question, answer } = deps.runs.ask(task, turnQuestion(turn.reason));
      return Promise.race([banner, answer.then((choice) => choice === "done")]).finally(() => {
        signal?.removeEventListener("abort", onAbort);
        deps.runs.answer(task, question.id, null);
        controller.abort();
      });
    },
  };
}
