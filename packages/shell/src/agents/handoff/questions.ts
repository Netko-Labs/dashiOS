/**
 * An agent from the launcher asks its questions in the menu bar's panel, not
 * in sheets over the person's work (docs/actions.md, "Agents from the
 * launcher"): which login (Allow for this task, Once, Other login…, Don't),
 * a website, a hand-over (do it, then Done), another permission, or one
 * action. The question goes on the run's card (store.ts) and the mark turns
 * amber. It shows in one place at a time (route.ts): on the card while the
 * panel is open; while it is closed, in the existing sheet (or the
 * hand-over banner), with a notification. The first answer, in either
 * place, settles it and the other comes down. Payments keep dashi-secretd's
 * own fingerprint or password sheet and nothing else: that is the proof.
 *
 * Any other agent's questions go to the sheets as before.
 */

import type { AgentUi, Allow, Answer, SignInAsk, SignInChoice } from "../presence.ts";
import { DENY } from "../sheet-queue.ts";
import { type Asked, type PanelDeps, TwoPlaces, type TwoPlacesOptions } from "./lib/two-places.ts";

export interface QuestionDeps extends PanelDeps {
  /** The run an MCP connection belongs to (its sandbox's scope), or null. */
  taskOf(agent: number): string | null;
}

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

/** Ask `asked` on run `task`'s card, and in the sheet whenever the panel is closed (two-places.ts); the first answer counts. */
const both = <T>(deps: QuestionDeps, task: string, asked: Asked, options: TwoPlacesOptions<T>): Promise<T> => new TwoPlaces(deps, task, asked, options).ask();

type Ask = Parameters<AgentUi["ask"]>[0];
type Confirm = Parameters<AgentUi["confirm"]>[0];
type SiteAsk = Parameters<AgentUi["allowSite"]>[0];
type Turn = Parameters<AgentUi["turn"]>[0];

function askScopes(ui: AgentUi, deps: QuestionDeps, task: string, ask: Ask, signal: AbortSignal | undefined): Promise<Answer> {
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
  return both<Answer>(deps, task, asked, {
    sheet: (inner) => ui.ask(ask, inner),
    fromPanel: (choice) => (choice === "once" ? { allow: "once", scopes: needed.map((scope) => scope.id) } : DENY),
    refused: DENY,
    signal,
  });
}

function confirmAction(ui: AgentUi, deps: QuestionDeps, task: string, confirm: Confirm, signal: AbortSignal | undefined): Promise<boolean> {
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
  return both<boolean>(deps, task, asked, { sheet: (inner) => ui.confirm(confirm, inner), fromPanel: (choice) => choice === "yes", refused: false, signal });
}

function allowSite(ui: AgentUi, deps: QuestionDeps, task: string, ask: SiteAsk, signal: AbortSignal | undefined): Promise<Allow> {
  return both<Allow>(deps, task, siteQuestion(ask.site), {
    sheet: (inner) => ui.allowSite(ask, inner),
    fromPanel: (choice) => (choice === "once" || choice === "always" ? choice : "deny"),
    refused: "deny",
    signal,
  });
}

function signIn(ui: AgentUi, deps: QuestionDeps, task: string, ask: SignInAsk, signal: AbortSignal | undefined): Promise<SignInChoice> {
  let index = 0;
  const login = () => ask.logins[index % Math.max(1, ask.logins.length)]?.key ?? null;
  return both<SignInChoice>(deps, task, signInQuestion(ask, index), {
    sheet: (inner) => ui.signIn(ask, inner),
    fromPanel: (choice) => {
      if (choice === "other") {
        index += 1;
        return "again";
      }
      const key = login();
      if ((choice === "task" || choice === "once") && key) return { allow: choice, login: key };
      return { allow: "deny", login: null };
    },
    refused: { allow: "deny", login: null },
    signal,
    again: () => signInQuestion(ask, index),
  });
}

// The banner is the hand-over's sheet: up while the panel is closed; Done there or on the card.
function handOver(ui: AgentUi, deps: QuestionDeps, task: string, turn: Turn, signal: AbortSignal | undefined): Promise<boolean> {
  return both<boolean>(deps, task, turnQuestion(turn.reason), {
    sheet: (inner) => ui.turn(turn, inner),
    fromPanel: (choice) => choice === "done",
    refused: false,
    signal,
  });
}

/**
 * The AgentUi the agents server uses: a task's questions in the panel (and
 * the sheets while it is closed), everyone else's in the sheets.
 */
export function routedUi(ui: AgentUi, deps: QuestionDeps): AgentUi {
  return {
    ...ui,
    ask: (ask, signal) => {
      const task = deps.taskOf(ask.agent);
      return task ? askScopes(ui, deps, task, ask, signal) : ui.ask(ask, signal);
    },
    confirm: (confirm, signal) => {
      const task = deps.taskOf(confirm.agent);
      return task ? confirmAction(ui, deps, task, confirm, signal) : ui.confirm(confirm, signal);
    },
    allowSite: (ask, signal) => {
      const task = deps.taskOf(ask.agent);
      return task ? allowSite(ui, deps, task, ask, signal) : ui.allowSite(ask, signal);
    },
    signIn: (ask, signal) => {
      const task = deps.taskOf(ask.agent);
      return task ? signIn(ui, deps, task, ask, signal) : ui.signIn(ask, signal);
    },
    turn: (turn, signal) => {
      const task = deps.taskOf(turn.agent);
      return task ? handOver(ui, deps, task, turn, signal) : ui.turn(turn, signal);
    },
  };
}
