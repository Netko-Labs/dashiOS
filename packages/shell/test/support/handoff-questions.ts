import { routedUi } from "../../src/agents/handoff/questions.ts";
import { AgentRuns } from "../../src/agents/handoff/store.ts";
import type { AgentUi, Allow, Answer, SignInAsk, SignInChoice } from "../../src/agents/presence.ts";
import { DENY } from "../../src/agents/sheet-queue.ts";

export const who = { name: "claude", detail: "~/.local/bin/claude", claims: null, remote: false };
export const ask: SignInAsk = {
  agent: 7,
  who,
  summary: "sign in to bodytech.com.co",
  logins: [
    { key: "dashi:1", account: "alexk", site: "bodytech.com.co", source: "Dashi" },
    { key: "op:2", account: "alex.kim", site: "bodytech.com.co", source: "1Password" },
  ],
};

/** The sheets, as a stand-in: each records it went up and came down, and answers when the test says. */
function sheets() {
  const up: string[] = [];
  const down: string[] = [];
  const answers = new Map<string, (value: unknown) => void>();
  /** A sheet of `kind`: up until answered, or taken down (then a no, as the queue answers). */
  const sheet =
    <T>(kind: string, no: T) =>
    (_ask: unknown, signal?: AbortSignal): Promise<T> => {
      up.push(kind);
      return new Promise<T>((resolve) => {
        answers.set(kind, resolve as (value: unknown) => void);
        signal?.addEventListener("abort", () => {
          down.push(kind);
          resolve(no);
        });
      });
    };
  const ui = {
    signIn: sheet<SignInChoice>("sign-in", { allow: "deny", login: null }),
    allowSite: sheet<Allow>("site", "deny"),
    ask: sheet<Answer>("scopes", DENY),
    confirm: sheet<boolean>("confirm", false),
    turn: sheet<boolean>("turn", false),
  } as unknown as AgentUi;
  return {
    ui,
    up,
    down,
    answer: (kind: string, value: unknown) => answers.get(kind)?.(value),
    answerSignIn: (choice: SignInChoice) => answers.get("sign-in")?.(choice),
  };
}

export function setUp(open: boolean) {
  const runs = new AgentRuns();
  runs.start({ id: "run1", request: "Book a class", harness: "claude-code", harnessName: "Claude Code" });
  const listeners = new Set<(open: boolean) => void>();
  const attention: string[] = [];
  const fake = sheets();
  let panel = open;
  const ui = routedUi(fake.ui, {
    taskOf: (agent) => (agent === 7 ? "run1" : null),
    runs,
    panelOpen: () => panel,
    onPanel(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    attention: (_run, question) => attention.push(question.title),
  });
  const setPanel = (now: boolean) => {
    panel = now;
    for (const listener of [...listeners]) listener(now);
  };
  /** The panel's answer to the question on the card now, as the shell gives it: recorded, then the panel closes. */
  const answerInPanel = (choice: string) => {
    const answered = runs.answer("run1", runs.get("run1")?.question?.id ?? "", choice);
    if (choice !== "other") setPanel(false);
    return answered;
  };
  return { runs, ui, fake, attention, closePanel: () => setPanel(false), openPanel: () => setPanel(true), answerInPanel, listeners };
}
