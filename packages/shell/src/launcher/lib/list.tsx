/**
 * The launcher's list under the field (launcher.tsx), as each mode draws it:
 * the search's sections (a window at a time, a row's windows' pictures under
 * it), a row's action list, the alias and shortcut rows, a plan, the grants
 * card, a run being written to.
 */

import type { Palette } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { listAccess, pictureAccess, rowAccess } from "../access.ts";
import { STRIP_HEIGHT, trimForPictures } from "../pictures.ts";
import type { LauncherProps } from "../props.ts";
import type { Row } from "../row-model.ts";
import type { Section } from "../sections.ts";
import { withStop } from "./agents/agent-rows.ts";
import { runRow } from "./agents/handoff-rows.ts";
import { chosenContext, GrantsCard } from "./agents/handoff-views.tsx";
import { PlanList, stepAct } from "./agents/plan-view.tsx";
import type { LauncherKeys } from "./commands.ts";
import { type Measures, PANEL } from "./measures.ts";
import type { ModeLists } from "./mode.ts";
import { nameIndent, ReservedRows, ResultRow, SectionHead } from "./row-view.tsx";
import { keepInView, wheelSteps } from "./selection.ts";
import type { LauncherState, Search } from "./state.ts";
import type { Acts } from "./use-acts.ts";
import { WindowStrip } from "./window-strip.tsx";

/** The search's sections as drawn now, and the rows on screen top to bottom (what ❖1–9 pick). */
export function drawnSections(s: LauncherState, search: Search, m: Measures): { onScreen: Section[]; drawnRows: () => Row[] } {
  const { pictures, selected } = search;
  const drawn = (section: Section): Row[] => {
    // A scope's list and All apps (a `window`, as many as fit at the text size) are drawn a window at a time.
    if (section.window === undefined) return section.rows;
    const shown = Math.min(section.window, m.listRows);
    const at = Math.max(
      0,
      section.rows.findIndex((row) => row.id === selected),
    );
    // With a row's pictures open, fewer of them, so the pictures fit too.
    const size = pictures.rowId ? Math.min(shown, Math.max(1, Math.floor((m.room - m.head - STRIP_HEIGHT) / m.row))) : shown;
    s.offset.current = keepInView(at, s.offset.current, size, section.rows.length);
    return section.rows.slice(s.offset.current, s.offset.current + size);
  };
  // With a row's pictures open, the rows below it give way so the panel still fits (launcher/pictures.ts).
  const onScreen = trimForPictures(
    search.sections.map((section) => ({ ...section, rows: drawn(section) })),
    m,
    pictures.rowId,
  );
  return { onScreen, drawnRows: () => onScreen.flatMap((section) => section.rows) };
}

interface ListInput {
  props: LauncherProps;
  s: LauncherState;
  search: Search;
  lists: ModeLists;
  acts: Acts;
  keys: LauncherKeys;
  m: Measures;
  colors: Palette;
  onScreen: Section[];
  drawnRows: () => Row[];
}

type Spoken = (row: Row, list: readonly Row[], isSelected: boolean, expanded?: boolean) => { access?: Record<string, unknown> };

/** The list in the mode the launcher is in; null when there is nothing to list. */
export function listFor(input: ListInput): ReactNode {
  const { props, s, search, lists, acts, keys, colors } = input;
  const { mode } = s;
  // What a screen reader hears (launcher/access.ts): only on a host that publishes the tree.
  const access = props.accessible === true;
  const spoken: Spoken = (row, list, isSelected, expanded) =>
    access ? { access: { ...rowAccess(row, list.indexOf(row) + 1, list.length, isSelected, expanded) } } : {};
  const listBox = (children: ReactNode) => (
    <View
      testID="launcher:list"
      {...(access ? listAccess(mode.kind === "search" ? "Results" : "Actions") : {})}
      // The wheel and the touchpad move the selection, as ↑ and ↓ do, so a list drawn a window at a time scrolls.
      onWheel={(event) => {
        const { steps, rest } = wheelSteps(s.wheelRest.current, event.dy);
        s.wheelRest.current = rest;
        for (let step = 0; step < Math.abs(steps); step++) acts.move.current(steps > 0 ? "down" : "up");
      }}
      style={{
        flexDirection: "column",
        borderTopWidth: 1,
        borderColor: colors.separator,
        padding: PANEL.padding,
        ...(props.heightTransitionMs ? { heightTransitionMs: props.heightTransitionMs } : {}),
      }}
    >
      {children}
    </View>
  );
  let list: ReactNode = null;
  if (mode.kind === "search" && search.sections.length > 0) list = listBox(searchList(input, spoken, access));
  else if (mode.kind === "actions" || mode.kind === "presented")
    list = listBox(
      <View testID="launcher:section:actions" style={{ flexDirection: "column" }}>
        {lists.shownVerbs.map((row) => (
          <ResultRow
            key={row.id}
            row={row}
            selected={row.id === lists.selectedVerbId}
            onPress={() => acts.doVerb(lists.verbs[lists.verbRows.indexOf(row)], mode.kind === "actions" ? mode.row : undefined)}
            onHover={() => s.setHeldVerb(row.id)}
            {...spoken(row, lists.verbRows, row.id === lists.selectedVerbId)}
          />
        ))}
      </View>,
    );
  else if (lists.editRows.length > 0)
    list = listBox(
      <View testID={`launcher:section:${mode.kind}`} style={{ flexDirection: "column" }}>
        {lists.editRows.map((row) => (
          <ResultRow key={row.id} row={row} selected={row.shortcut !== undefined} onPress={() => keys.submit()} onHover={() => {}} />
        ))}
      </View>,
    );
  else if (mode.kind === "task" && search.task) list = listBox(planList(input));
  if (mode.kind === "grants") list = listBox(grantsCard(input));
  const messaged = mode.kind === "message" ? s.handoff?.runs.find((each) => each.id === mode.run) : undefined;
  if (messaged)
    list = listBox(
      <View testID="launcher:section:message" style={{ flexDirection: "column" }}>
        <ResultRow row={runRow(messaged)} selected={false} onPress={() => props.handoff?.open(messaged.id)} onHover={() => {}} />
      </View>,
    );
  return list;
}

/** The search's sections: each row, and under the one whose windows show, their live pictures. */
function searchList({ s, search, acts, m, onScreen, drawnRows }: ListInput, spoken: Spoken, access: boolean): ReactNode {
  const { pictures, selected, rows, verbsOf } = search;
  const digitOf = new Map(
    s.digits && s.mode.kind === "search"
      ? drawnRows()
          .slice(0, 9)
          .map((row, at) => [row.id, at + 1] as const)
      : [],
  );
  return onScreen.map((section) => (
    <View key={section.id} testID={`launcher:section:${section.id}`} style={{ flexDirection: "column" }}>
      {section.title !== undefined && <SectionHead title={section.title} {...(section.aside ? { aside: section.aside } : {})} />}
      {section.rows.flatMap((row) => {
        const showing = row.id === pictures.rowId;
        const shownRow = showing && pictures.picked ? { ...row, detail: pictures.picked.title.trim() || pictures.picked.appName } : row;
        const digit = digitOf.get(row.id);
        return [
          <ResultRow
            key={row.id}
            row={shownRow}
            selected={row.id === selected}
            onPress={() => acts.doVerb(verbsOf(row)[0], row)}
            onHover={() => s.setHeld(row.id)}
            onContextMenu={() => {
              s.setHeld(row.id);
              acts.openActions(row);
            }}
            {...(digit !== undefined ? { digit } : {})}
            {...spoken(row, rows, row.id === selected, showing ? true : undefined)}
            {...withStop(row, acts.agentKeys.act)}
          />,
          ...(showing
            ? [
                <WindowStrip
                  key={`${row.id}:pictures`}
                  windows={pictures.shown}
                  picked={pictures.pickedIndex}
                  indent={nameIndent(m)}
                  onLayout={pictures.layout}
                  onPick={(index) => pictures.pick(index)}
                  {...(access
                    ? {
                        access: (window, index) => ({
                          ...pictureAccess(
                            window.title.trim() || window.appName,
                            pictures.at - pictures.pickedIndex + index + 1,
                            pictures.count,
                            index === pictures.pickedIndex,
                          ),
                        }),
                      }
                    : {})}
                />,
              ]
            : []),
        ];
      })}
      {section.reserved !== undefined && <ReservedRows count={section.reserved} />}
    </View>
  ));
}

/** An Ask's plan: its steps, a step that can act acting on a press. */
function planList({ s, search, lists, acts }: ListInput): ReactNode {
  const task = search.task;
  if (!task) return null;
  return (
    <PlanList
      task={task}
      selected={lists.heldStep}
      onStep={(at) => {
        const step = task.steps[at];
        if (step && stepAct(step)) acts.agentKeys.submit(at);
      }}
      onHover={(at) => s.setHeldVerb(`step:${at}`)}
    />
  );
}

/** The grants card before a hand-off starts: Start, or Change in Settings. */
function grantsCard({ props, s, keys }: ListInput): ReactNode {
  const { mode } = s;
  if (mode.kind !== "grants") return null;
  const harness = s.handoff?.harnesses.find((each) => each.id === mode.harness);
  return (
    <GrantsCard
      harness={harness?.name ?? "The agent"}
      context={chosenContext(s.context, s.chipsOn)}
      selected={s.grantsRow}
      onStart={() => {
        s.setGrantsRow(0);
        keys.submit();
      }}
      onChange={() => {
        props.handoff?.settings();
        props.onClose();
      }}
      onHover={s.setGrantsRow}
    />
  );
}
