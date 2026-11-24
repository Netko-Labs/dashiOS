/**
 * "Allow Claude to sign in to github.com as alexk?": which saved login an
 * agent may use (agents/secrets/broker.ts), each with where it is saved, the
 * most recently used first. Dashi types the secret; the agent sees dots.
 * "Allow for this task" lasts while the agent stays connected; "Allow once"
 * covers this sign-in and its one-time code. The alert frame (UI-5) with the
 * agents' shiso tile; the logins are pick rows (UI-13). A grant: only a click.
 */

import { AlertSheet, PickList, PickRow } from "@dashi/ui";
import { useState } from "react";
import type { SignInAsk, SignInChoice } from "../../agents/index.ts";
import { AGENT_GLYPH, agentSubject } from "../../consent.tsx";

/** The sheet's surface, room for its shadow and five logins. */
export const SIGN_IN = { width: 480, height: 470 } as const;
const WIDTH = SIGN_IN.width - 60;
const MAX_SHOWN = 5;

export function SignInSheet({ ask, onAnswer }: { ask: SignInAsk; onAnswer: (choice: SignInChoice) => void }) {
  const logins = ask.logins.slice(0, MAX_SHOWN);
  const [chosen, setChosen] = useState(logins[0]?.key ?? null);
  const picked = logins.find((login) => login.key === chosen);
  const subject = agentSubject(ask.who);
  const question = `Allow ${subject} to ${ask.summary}${picked && logins.length === 1 ? ` as ${picked.account}` : ""}?`;
  const answer = (allow: SignInChoice["allow"]) => onAnswer({ allow, login: allow === "deny" ? null : chosen });
  return (
    <AlertSheet
      testID="sign-in-sheet"
      place="screen"
      keys={false}
      width={WIDTH}
      question={question}
      message={`Dashi fills it in. ${agentSubject(ask.who, true)} sees dots.`}
      glyph={AGENT_GLYPH}
      tone="agent"
      buttons={[
        { label: "Don’t allow", testID: "sign-in-deny", onPress: () => answer("deny"), cancel: true },
        { label: "Allow for this task", testID: "sign-in-task", onPress: () => answer("task") },
        { label: "Allow once", testID: "sign-in-once", onPress: () => answer("once"), kind: "primary", isDefault: false },
      ]}
    >
      <PickList testID="sign-in-logins">
        {logins.map((login) => (
          <PickRow
            key={login.key}
            testID={`sign-in-login:${login.key}`}
            label={login.account}
            detail={`${login.site} · ${login.source}`}
            chosen={login.key === chosen}
            onPress={() => setChosen(login.key)}
          />
        ))}
      </PickList>
    </AlertSheet>
  );
}
