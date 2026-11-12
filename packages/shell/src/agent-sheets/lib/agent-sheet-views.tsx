/**
 * The agents' sheets, one builder each (../agent-sheets.tsx queues and shows
 * them): the view, how the person's answer becomes the queue's `Answer`,
 * and how that settles the asker's promise.
 */

import type { ReactElement } from "react";
import { PersonConfirmSheet, type PersonQuestion } from "../../actions/index.ts";
import {
  type Allow,
  type Answer,
  type Ask,
  type Confirm,
  DENY,
  type PersonAnswer,
  type PersonAsk,
  type QueuedSheet,
  type SignInAsk,
  type SignInChoice,
  type SiteAsk,
} from "../../agents/index.ts";
import { ConfirmSheet } from "../../confirm-sheet.tsx";
import { ConsentSheet } from "../../consent.tsx";
import { QUESTION, QuestionSheet, spokenQuestion } from "./question-sheet.tsx";
import { SIGN_IN, SignInSheet } from "./sign-in-sheet.tsx";

/** A sheet and how to draw it, given how the person's answer gets back. */
export interface Sheet extends QueuedSheet {
  view(answer: (answer: Answer) => void): ReactElement;
  /** The surface, when not the consent sheet's. */
  size?: { width: number; height: number };
  /** Runs as it comes on screen, with the way to answer it from outside the sheet (a spoken answer); returns what to run as it comes down. */
  shown?(answer: (answer: Answer) => void): () => void;
}

/** Voice, as a question uses it (voice/voice.ts): says the question, hears the answer, names the talk key. */
export interface QuestionVoice {
  ask(words: string, heard: (text: string) => void): () => void;
  talkKey(): string | null;
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

/**
 * A question in words (`ask_person`). On the queue's Answer the words ride in
 * `scopes`. Typed, they count only as the person's own press (the queue's
 * check); spoken, they come from the talk key, which only the person's hands
 * hold (the compositor never takes an agent's key for it).
 */
export function questionSheet(ask: PersonAsk, voice: QuestionVoice | null, resolve: (answer: PersonAnswer) => void): Sheet {
  let by: "voice" | "typing" = "typing";
  let declined = false;
  return {
    agent: ask.agent,
    size: QUESTION,
    timeoutMs: ask.seconds * 1000,
    view: (answer) => (
      <QuestionSheet
        ask={ask}
        talkKey={voice?.talkKey() ?? null}
        onAnswer={(text) => {
          declined = text === null;
          answer(text === null ? DENY : { allow: "once", scopes: [text] });
        }}
      />
    ),
    shown: (answer) =>
      voice?.ask(spokenQuestion(ask), (text) => {
        by = "voice";
        answer({ allow: "once", scopes: [text] });
      }) ?? (() => {}),
    resolve: (answer) => {
      const text = answer.scopes[0]?.trim() ?? "";
      resolve(answer.allow === "deny" || text === "" ? { none: declined ? "declined" : "no-answer" } : { text, by });
    },
  };
}
