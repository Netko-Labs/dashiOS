/**
 * The sheet for one action that can't be taken back, such as force quitting
 * an app on an agent's say-so. The alert frame (UI-5) with the agents' shiso
 * tile, like the consent sheet (agents/confirm.ts says when it is used), but
 * with no "Always allow": it asks every time. "Don’t allow" is the neutral
 * button; the one that goes ahead is ume only for what loses work or can't be
 * taken back (`danger`), else the ink primary: "Show copies" and "Install"
 * are not alarms. A website an agent asks to use (agents/sites.ts) is the one
 * question here that may be kept: it has "Allow once" and "Always allow".
 * A grant: only a click answers it, never the keyboard by itself.
 */

import { type AlertButton, AlertSheet, TYPE, useColors } from "@dashi/ui";
import { Text } from "@mirinjs/metal";
import type { Confirm } from "./agents/index.ts";
import { AGENT_GLYPH, agentOrigin, agentSubject, goAheadKind, StopLine } from "./consent.tsx";

/** The sheet's card on its surface. */
const WIDTH = 440;

/**
 * With `onAlways`, the answer may be kept (a website an agent asks to use:
 * agents/sites.ts): "Allow once" and "Always allow" instead of the one button.
 */
export function ConfirmSheet({ confirm, onAnswer, onAlways }: { confirm: Confirm; onAnswer: (yes: boolean) => void; onAlways?: () => void }) {
  const colors = useColors();
  const { who } = confirm;
  const deny: AlertButton = { label: "Don’t allow", testID: "confirm-deny", onPress: () => onAnswer(false), cancel: true };
  const buttons: AlertButton[] = onAlways
    ? [
        deny,
        { label: "Allow once", testID: "confirm-once", onPress: () => onAnswer(true) },
        { label: "Always allow", testID: "confirm-always", onPress: onAlways, kind: "primary", isDefault: false },
      ]
    : [deny, { label: confirm.action, testID: "confirm-go", onPress: () => onAnswer(true), kind: goAheadKind(confirm.danger), isDefault: false }];
  return (
    <AlertSheet
      testID="agent-confirm"
      place="screen"
      keys={false}
      width={WIDTH}
      question={`Allow ${agentSubject(who)} to ${confirm.summary}?`}
      message={agentOrigin(who)}
      glyph={AGENT_GLYPH}
      tone="agent"
      buttons={buttons}
    >
      <Text style={{ fontSize: TYPE.body.size, lineHeight: TYPE.body.line, color: colors.text }}>{confirm.detail}</Text>
      <StopLine words={onAlways ? "Dashi asks once for each site. Stop every agent with" : "It asks every time. Stop every agent with"} />
    </AlertSheet>
  );
}
