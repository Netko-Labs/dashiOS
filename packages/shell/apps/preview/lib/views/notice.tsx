/** The notice over the content's foot, while there is one (use-notice.ts): the kit's Notice, Undo after the words when it can take the step back. */

import { Button, Notice } from "@dashi/ui";
import type { ReactElement } from "react";
import type { Notices } from "../hooks/use-notice.ts";

export function noticeView({ notice, dismiss }: Notices): ReactElement | null {
  if (notice === null) return null;
  const { undo } = notice;
  const action = undo ? (
    <Button
      testID="notice:undo"
      label="Undo"
      onPress={() => {
        dismiss();
        undo();
      }}
    />
  ) : undefined;
  return <Notice key={notice.id} testID="notice" text={notice.text} tone={notice.tone} onDismiss={dismiss} {...(action ? { action } : {})} />;
}
