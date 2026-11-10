/**
 * The agents' sheets, one builder each (agent-sheets.tsx queues and shows
 * them): the view, how the person's answer becomes the queue's `Answer`,
 * and how that settles the asker's promise.
 */

import type { ReactElement } from "react";
import { PersonConfirmSheet, type PersonQuestion } from "./actions/confirm-sheet.tsx";
import type { Allow, Answer, Ask } from "./agents/index.ts";
import type { Confirm, SignInAsk, SignInChoice, SiteAsk } from "./agents/presence.ts";
import { DENY, type QueuedSheet } from "./agents/sheet-queue.ts";
import { ConfirmSheet } from "./confirm-sheet.tsx";
import { ConsentSheet } from "./consent.tsx";
import { SIGN_IN, SignInSheet } from "./sign-in-sheet.tsx";

/** A sheet and how to draw it, given how the person's answer gets back. */
export interface Sheet extends QueuedSheet {
  view(answer: (answer: Answer) => void): ReactElement;
  /** The surface, when not the consent sheet's. */
  size?: { width: number; height: number };
}

/** A plain yes is allowed once; a no is the queue's DENY. */
const yesNo = (yes: boolean): Answer => (yes ? { allow: "once", scopes: [] } : DENY);

export function askSheet(ask: Ask, resolve: Sheet["resolve"]): Sheet {
  return {
    agent: ask.agent,
    view: (answer) => <ConsentSheet ask={ask} onAnswer={(allow, scopes) => answer({ allow, scopes })} />,
    resolve,
  };
}

export function confirmSheet(confirm: Confirm, resolve: (allowed: boolean) => void): Sheet {
  return {
    agent: confirm.agent,
    view: (answer) => <ConfirmSheet confirm={confirm} onAnswer={(yes) => answer(yesNo(yes))} />,
    resolve: (answer) => resolve(answer.allow !== "deny"),
  };
}

export function allowSiteSheet(ask: SiteAsk, resolve: (allow: Allow) => void): Sheet {
  const confirm = {
    agent: ask.agent,
    who: ask.who,
    summary: `use ${ask.site}`,
    detail: `It could read the pages of ${ask.site} in your browser as text, and click, fill in and choose things on them. It never sees what password, card or code fields hold.`,
    action: "Allow",
  };
  return {
    agent: ask.agent,
    view: (answer) => <ConfirmSheet confirm={confirm} onAnswer={(yes) => answer(yesNo(yes))} onAlways={() => answer({ allow: "always", scopes: [] })} />,
    resolve: (answer) => resolve(answer.allow),
  };
}

export function personSheet(agent: number, question: PersonQuestion, resolve: (allowed: boolean) => void): Sheet {
  return {
    agent,
    view: (answer) => <PersonConfirmSheet question={question} onAnswer={(yes) => answer(yesNo(yes))} />,
    resolve: (answer) => resolve(answer.allow !== "deny"),
  };
}

/** On the queue's Answer: "always" stands for "Allow for This Task", the login's key rides in `scopes`. */
export function signInSheet(ask: SignInAsk, resolve: (choice: SignInChoice) => void): Sheet {
  return {
    agent: ask.agent,
    size: SIGN_IN,
    view: (answer) => (
      <SignInSheet
        ask={ask}
        onAnswer={(choice) =>
          answer(choice.allow === "deny" || !choice.login ? DENY : { allow: choice.allow === "task" ? "always" : "once", scopes: [choice.login] })
        }
      />
    ),
    resolve: (answer) =>
      resolve(
        answer.allow === "deny" ? { allow: "deny", login: null } : { allow: answer.allow === "always" ? "task" : "once", login: answer.scopes[0] ?? null },
      ),
  };
}
