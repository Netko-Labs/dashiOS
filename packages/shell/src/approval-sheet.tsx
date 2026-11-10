/**
 * dashi-secretd's questions on screen (agents/secrets/approvals.ts): "Use
 * your passkey for github.com?", "Pay Uniqlo $48.90?". Touch the fingerprint
 * reader (dashi-secretd checks it and the sheet comes down), or type the
 * password (dashi-secretd checks that too). It sits on the consent sheets'
 * layer, so agents' pictures blank it.
 */

import { TextSelectionLook, useColors } from "@dashi/ui";
import { type NativeHostTransport, type NativeRoot, render, Text, TextInput, View } from "@mirinjs/metal";
import { useState } from "react";
import { SHEET_LAYERS } from "./agents/index.ts";
import { type ApprovalsUi, describe, type Question } from "./agents/secrets/approvals.ts";
import { Button, opaque } from "./consent.tsx";
import { spawnShellHost } from "./shared/metal/index.ts";

export const APPROVAL = { width: 460, height: 300 } as const;

function ApprovalSheet({ question, onApprove, onDeny }: { question: Question; onApprove: (password: string) => Promise<string | null>; onDeny: () => void }) {
  const colors = useColors();
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const words = describe(question);
  const approve = () => {
    if (!password) return;
    void onApprove(password).then((error) => {
      setPassword("");
      setProblem(error);
    });
  };
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        style={{
          width: APPROVAL.width - 60,
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          padding: 22,
          borderRadius: 18,
          backgroundColor: opaque(colors.launcher),
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        <View style={{ width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: colors.agentWash }}>
          <Text style={{ fontSize: 22, color: colors.agentInk }}>◎</Text>
        </View>
        <Text style={{ fontSize: 16, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{words.title}</Text>
        <Text style={{ fontSize: 12, color: problem ? colors.critical : colors.textMuted, textAlign: "center" }}>{problem ?? words.detail}</Text>
        <View style={{ alignSelf: "stretch", marginTop: 8 }}>
          <TextInput
            testID="approval-password"
            value={password}
            placeholder="Password"
            secureTextEntry
            onChangeText={setPassword}
            onSubmitEditing={approve}
            style={{ width: "100%", fontSize: 13, padding: 7, borderRadius: 7, color: colors.text, backgroundColor: colors.button }}
          />
        </View>
        <View style={{ alignSelf: "stretch", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
          <Button label="Deny" onPress={onDeny} />
          <Button label={question.kind === "pay" ? "Pay" : "Allow"} primary onPress={approve} />
        </View>
      </View>
    </View>
  );
}

/** The sheets, one per open question. */
export function createApprovalUi(): ApprovalsUi & { close(): void } {
  const open = new Map<number, { host: NativeHostTransport; root: NativeRoot }>();
  const hide = (id: number) => {
    const sheet = open.get(id);
    if (!sheet) return;
    open.delete(id);
    sheet.root.unmount();
    sheet.host.close();
  };
  return {
    show(question, answer) {
      hide(question.id);
      const host = spawnShellHost({
        title: "Dashi's vault",
        appId: "dev.dashi.shell",
        width: APPROVAL.width,
        height: APPROVAL.height,
        // It takes the keyboard: the password is typed here.
        surface: { layer: "overlay", keyboard: "exclusive", namespace: SHEET_LAYERS[0] },
      });
      const root = render(
        <TextSelectionLook>
          <ApprovalSheet
            question={question}
            onApprove={answer.approve}
            onDeny={() => {
              answer.deny();
              hide(question.id);
            }}
          />
        </TextSelectionLook>,
        host,
      );
      open.set(question.id, { host, root });
      host.onClose(() => {
        if (open.has(question.id)) {
          answer.deny();
          hide(question.id);
        }
      });
    },
    hide,
    close() {
      for (const id of [...open.keys()]) hide(id);
    },
  };
}
