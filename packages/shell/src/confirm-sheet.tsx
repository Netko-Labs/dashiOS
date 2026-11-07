/**
 * The sheet for one action that can't be taken back, such as force quitting
 * an app on an agent's say-so. It looks like the consent sheet (agents/
 * confirm.ts says when it is used) but has no "Always Allow": it asks every
 * time. "Don't Allow" is the neutral button; the one that goes ahead is red
 * only for what loses work or can't be taken back (`danger`), else it is the
 * primary one: "Show Copies" and "Install" are not alarms. A website an
 * agent asks to use (agents/sites.ts) is the one question here that may be
 * kept: it has Allow Once and Always Allow.
 */

import { Shortcut, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { Confirm } from "./agents/index.ts";
import { AgentMark, Button, goAheadLook, opaque } from "./consent.tsx";

/**
 * With `onAlways`, the answer may be kept (a website an agent asks to use:
 * agents/sites.ts): "Allow Once" and "Always Allow" instead of the one button.
 */
export function ConfirmSheet({ confirm, onAnswer, onAlways }: { confirm: Confirm; onAnswer: (yes: boolean) => void; onAlways?: () => void }) {
  const colors = useColors();
  const { who } = confirm;
  const subject = who.remote ? "An agent on another machine" : who.name;
  const origin = [who.detail, who.claims ? `says it is “${who.claims}”` : null].filter(Boolean).join(" · ");
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        style={{
          width: 440,
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
          <Text style={{ fontSize: 16, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{`${subject} wants to ${confirm.summary}`}</Text>
        </View>
        <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{origin}</Text>
        <View style={{ marginTop: 10 }}>
          <Text style={{ fontSize: 13, color: colors.text, textAlign: "center" }}>{confirm.detail}</Text>
        </View>
        <View style={{ alignSelf: "stretch", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Button label="Don't Allow" onPress={() => onAnswer(false)} />
          {onAlways ? (
            <>
              <Button label="Allow Once" onPress={() => onAnswer(true)} />
              <Button label="Always Allow" {...goAheadLook(false)} onPress={onAlways} />
            </>
          ) : (
            <Button label={confirm.action} {...goAheadLook(confirm.danger)} onPress={() => onAnswer(true)} />
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12 }}>
          <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
            {onAlways ? "Dashi asks once for each site. Stop every agent with" : "It asks every time. Stop every agent with"}
          </Text>
          <Shortcut keys="⌃❖Esc" color={colors.textMuted} size={11.5} />
        </View>
      </View>
    </View>
  );
}
