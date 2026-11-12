/**
 * Everything both of the chooser's frames draw, worked out once: the
 * toolbar's two ends, the sidebar, a save's name field, a problem, the
 * foot, the keys and the question over it all.
 */

import { type ReactNode, useMemo } from "react";
import { BrowserKeys } from "../../browser.tsx";
import { quietActions } from "../../context.ts";
import { Peek } from "../../peek.tsx";
import { Sidebar } from "../../sidebar.tsx";
import type { ChooserViewProps } from "../../types.ts";
import { ChooserFooter, ChooserLeading, ChooserTools, NameRow, ProblemNote, ReplaceQuestion } from "./bars.tsx";
import { useChooserInput } from "./use-chooser-input.ts";

export function useChooserParts({ model, exists, answer }: ChooserViewProps) {
  const input = useChooserInput({ model, exists, answer });
  const { store, request } = model;
  const { state, files, focus, refocus } = input;
  const actions = useMemo(() => quietActions(refocus), [refocus]);
  const busy = state.replace !== null || input.peek || files.renaming !== null;

  // The search field (or a save's name) has the keyboard at first; the listing takes it once it is clicked or ↓ leaves the field.
  const keys = !busy && focus > 0 && <BrowserKeys focusKey={focus} onKey={input.onKey} onChord={input.hiddenChord} />;
  const overlay: ReactNode = state.replace ? (
    <ReplaceQuestion model={model} input={input} path={state.replace} />
  ) : input.peek ? (
    <Peek
      onClose={() => {
        input.setPeek(false);
        refocus();
      }}
    />
  ) : undefined;
  return {
    context: { store, ops: null, actions },
    keys,
    leading: <ChooserLeading model={model} input={input} />,
    tools: <ChooserTools model={model} input={input} />,
    sidebar: <Sidebar recents={request.mode === "open" && !request.directory} />,
    nameRow: request.mode === "save" && <NameRow model={model} input={input} />,
    problem: state.problem && <ProblemNote problem={state.problem} />,
    footer: <ChooserFooter model={model} input={input} cancel={() => answer(null)} />,
    overlay,
  };
}
