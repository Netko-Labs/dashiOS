/**
 * The notice that floats over the calendar until dismissed: what went wrong,
 * a delete with Undo, what an import or export did, or the events that could
 * not be shown.
 */

import { Button, Notice, type useUndo } from "@dashi/ui";
import { type ReactElement, useState } from "react";
import type { CalendarModel } from "../model.ts";
import type { CalendarState } from "../state.ts";

export interface CalendarNotice {
  notice: ReactElement | undefined;
  /** An event was deleted: say so, with Undo. */
  noteDeleted: (title: string) => void;
}

export function useNotice({
  model,
  state,
  undo,
  showProblems,
}: {
  model: CalendarModel;
  state: CalendarState;
  undo: ReturnType<typeof useUndo>;
  showProblems: () => void;
}): CalendarNotice {
  const [hiddenProblems, setHiddenProblems] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ text: string; step: number | null } | null>(null);
  const noteDeleted = (title: string): void => setDeleted({ text: `Deleted “${title || "New Event"}”.`, step: model.undo.state.undoStep });
  const problemsKey = state.problems.join("\n");
  const undoable = deleted !== null && deleted.step !== null && undo.undoStep === deleted.step;
  const notice = state.error ? (
    <Notice testID="message" tone="error" text={state.error} onDismiss={() => model.dismissMessages()} />
  ) : undoable && deleted ? (
    <Notice
      testID="message"
      text={deleted.text}
      action={<Button label="Undo" testID="message:undo" onPress={() => void model.undoStep("undo")} />}
      onDismiss={() => setDeleted(null)}
    />
  ) : state.notice ? (
    <Notice testID="message" text={state.notice} onDismiss={() => model.dismissMessages()} />
  ) : state.problems.length > 0 && problemsKey !== hiddenProblems ? (
    <Notice
      testID="message"
      text={state.problems.length === 1 ? "1 event couldn't be shown." : `${state.problems.length} events couldn't be shown.`}
      action={<Button label="Show" testID="message:show" onPress={showProblems} />}
      onDismiss={() => setHiddenProblems(problemsKey)}
    />
  ) : undefined;
  return { notice, noteDeleted };
}
