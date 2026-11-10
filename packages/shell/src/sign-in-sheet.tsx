/**
 * "Claude wants to sign in to github.com as alexk": which saved login an
 * agent may use (agents/secrets/broker.ts), each with where it is saved, the
 * most recently used first. Dashi types the secret; the agent sees dots.
 * "Allow for This Task" lasts while the agent stays connected; "Allow Once"
 * covers this sign-in and its one-time code.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { SignInAsk, SignInChoice } from "./agents/index.ts";
import { AgentMark, Button, opaque } from "./consent.tsx";

/** The sheet's surface, room for its shadow and five logins. */
export const SIGN_IN = { width: 480, height: 470 } as const;
const MAX_SHOWN = 5;

export function SignInSheet({ ask, onAnswer }: { ask: SignInAsk; onAnswer: (choice: SignInChoice) => void }) {
  const colors = useColors();
  const logins = ask.logins.slice(0, MAX_SHOWN);
  const [chosen, setChosen] = useState(logins[0]?.key ?? null);
  const picked = logins.find((login) => login.key === chosen);
  const subject = ask.who.remote ? "An agent on another machine" : ask.who.name;
  const title = `${subject} wants to ${ask.summary}${picked && logins.length === 1 ? ` as ${picked.account}` : ""}`;
  const answer = (allow: SignInChoice["allow"]) => onAnswer({ allow, login: allow === "deny" ? null : chosen });
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        style={{
          width: SIGN_IN.width - 60,
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: 22,
          borderRadius: 18,
          backgroundColor: opaque(colors.launcher),
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        <AgentMark size={46} />
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{title}</Text>
        </View>
        <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{`Dashi fills it in. ${subject} sees dots.`}</Text>
        <View style={{ alignSelf: "stretch", flexDirection: "column", marginTop: 12 }}>
          {logins.map((login, index) => {
            const on = login.key === chosen;
            return (
              <View
                key={login.key}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  height: 40,
                  paddingLeft: 10,
                  paddingRight: 10,
                  borderRadius: 8,
                  borderTopWidth: index === 0 || on ? 0 : 1,
                  borderColor: colors.separator,
                  backgroundColor: on ? colors.agentWash : "#00000000",
                }}
                onPress={() => setChosen(login.key)}
              >
                <View
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    borderWidth: on ? 4 : 1.5,
                    borderColor: on ? colors.selection : colors.checkbox,
                  }}
                />
                <View style={{ flex: 1, flexDirection: "column" }}>
                  <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>{login.account}</Text>
                  <Text style={{ fontSize: 11.5, color: colors.textMuted }}>{`${login.site} · ${login.source}`}</Text>
                </View>
                <Text style={{ fontSize: 13, color: colors.textMuted }}>••••••••••</Text>
              </View>
            );
          })}
        </View>
        <View style={{ alignSelf: "stretch", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Button label="Deny" onPress={() => answer("deny")} />
          <Button label="Allow for This Task" onPress={() => answer("task")} />
          <Button label="Allow Once" primary onPress={() => answer("once")} />
        </View>
      </View>
    </View>
  );
}
