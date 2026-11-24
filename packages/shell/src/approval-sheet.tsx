/**
 * dashi-secretd's questions on screen (agents/secrets/approvals.ts): "Use
 * your passkey for github.com?", "Pay Uniqlo $48.90?". Touch the fingerprint
 * reader (dashi-secretd checks it and the sheet comes down), or type the
 * password (dashi-secretd checks that too). It sits on the consent sheets'
 * layer, so agents' pictures blank it.
 */

import { AlertSheet, LOCK, TextField, TextSelectionLook } from "@dashi/ui";
import { type NativeHostTransport, type NativeRoot, render } from "@mirinjs/metal";
import { useState } from "react";
import { SHEET_LAYERS } from "./agents/index.ts";
import { type ApprovalsUi, describe, type Question } from "./agents/secrets/approvals.ts";
import { spawnShellHost } from "./shared/metal/index.ts";

export const APPROVAL = { width: 460, height: 300 } as const;
const WIDTH = APPROVAL.width - 60;

/**
 * The alert frame (UI-5) with the agents' shiso tile and a lock: the question,
 * what it is, the password field (UI-9), "Don’t allow" and the go-ahead. Only
 * the typed password answers it (Enter in the field); the sheet's own keys
 * never do.
 */
function ApprovalSheet({ question, onApprove, onDeny }: { question: Question; onApprove: (password: string) => Promise<string | null>; onDeny: () => void }) {
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
    <AlertSheet
      testID="approval-sheet"
      place="screen"
      keys={false}
      width={WIDTH}
      question={words.title}
      message={words.detail}
      glyph={LOCK}
      tone="agent"
      buttons={[
        { label: "Don’t allow", testID: "approval-deny", onPress: onDeny, cancel: true },
        { label: question.kind === "pay" ? "Pay" : "Allow", testID: "approval-go", onPress: approve, kind: "primary", disabled: password === "" },
      ]}
    >
      <TextField
        testID="approval-password"
        value={password}
        secure
        autoFocus
        placeholder="Password"
        onChangeText={(text) => {
          setPassword(text);
          if (problem) setProblem(null);
        }}
        onSubmit={approve}
        onKeyPress={(key) => key === "Escape" && onDeny()}
        {...(problem ? { message: problem, invalid: true } : {})}
      />
    </AlertSheet>
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
