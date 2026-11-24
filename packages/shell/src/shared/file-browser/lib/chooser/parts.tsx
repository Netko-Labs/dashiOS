/**
 * Everything both of the chooser's frames draw, worked out once: the
 * toolbar's two ends, the sidebar, a save's name field, a problem, the
 * foot, the keys and the question over it all.
 */

import { type ReactNode, useMemo } from "react";
import { BrowserKeys } from "../../browser.tsx";
import { quietActions } from "../../context.ts";
import { SuggestionList } from "../../omnibox-view.tsx";
import { Peek } from "../../peek.tsx";
import { Sidebar } from "../../sidebar.tsx";
import type { ChooserViewProps } from "../../types.ts";
import { ChooserFooter, ChooserLeading, ChooserOmnibox, ChooserTools, NameRow, ProblemNote, ReplaceQuestion } from "./bars.tsx";
import { useChooserInput } from "./use-chooser-input.ts";
import { useOmnibox } from "./use-omnibox.ts";

export function useChooserParts({ model, exists, answer }: ChooserViewProps) {
  const input = useChooserInput({ model, exists, answer });
  const { store, request } = model;
  const { state, files, focus, refocus } = input;
  const actions = useMemo(() => quietActions(refocus), [refocus]);
  const omnibox = useOmnibox();
  const busy = state.replace !== null || input.peek || files.renaming !== null || omnibox.editing !== null;

  // The listing has the keyboard at first (a save's name field takes it); the omnibox while it is edited.
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
  ) : omnibox.suggestions ? (
    <SuggestionList suggestions={omnibox.suggestions} home={store.env.home} />
  ) : undefined;
  return {
    context: { store, ops: null, actions },
    keys,
    leading: <ChooserLeading model={model} input={input} />,
    tools: <ChooserTools model={model} />,
    omnibox: <ChooserOmnibox omnibox={omnibox} refocus={refocus} />,
    sidebar: <Sidebar recents={request.mode === "open" && !request.directory} />,
    nameRow: request.mode === "save" && <NameRow model={model} input={input} />,
    // The chooser's own problem, or a typed path's that led nowhere (the omnibox says it through the store).
    problem: (state.problem ?? (files.notice?.error ? files.notice.text : null)) && <ProblemNote problem={state.problem ?? files.notice?.text ?? ""} />,
    footer: <ChooserFooter model={model} input={input} cancel={() => answer(null)} />,
    overlay,
  };
}
