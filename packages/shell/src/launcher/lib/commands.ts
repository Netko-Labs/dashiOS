/**
 * The launcher's keys (launcher.tsx): Return in each mode, the compositor's
 * commands (❖K, ❖↩, ❖1–9, ⇥, ⌥1–9, …: launcher/keys.ts), the field's words,
 * Esc stepping out, and what was typed ahead of the field.
 */

import { useEffect, useRef } from "react";
import { type ExtraKeys, type LauncherCommand, NO_EXTRA_KEYS } from "../keys.ts";
import { chordWhen } from "../person-keys.ts";
import type { LauncherProps } from "../props.ts";
import type { Row } from "../row-model.ts";
import { applyEdits } from "../type-ahead.ts";
import { KEYS, spaceFlips } from "../verbs.ts";
import { harnessByDigit } from "./agents/handoff-rows.ts";
import { chosenContext } from "./agents/handoff-views.tsx";
import { aliasToKeep, mayKeep } from "./editing.ts";
import type { ModeLists } from "./mode.ts";
import type { LauncherState, Search } from "./state.ts";
import type { Acts } from "./use-acts.ts";
import { useTypeAhead } from "./use-type-ahead.ts";

export interface LauncherKeys {
  submit(stay?: boolean): void;
  onChangeText(next: string): void;
  onKey(key: "Escape" | "ArrowUp" | "ArrowDown"): void;
}

interface Parts {
  props: LauncherProps;
  s: LauncherState;
  search: Search;
  lists: ModeLists;
  acts: Acts;
}

/** Return: the selected row's first verb, the chosen verb, the alias or key kept, the plan's step, the hand-off, the words sent. */
function submitter({ props, s, search, lists, acts }: Parts): (stay?: boolean) => void {
  const { mode, filter } = s;
  const { onClose } = props;
  return (stay = false) => {
    switch (mode.kind) {
      case "search":
        // A picked window's picture: switch to that window.
        if (search.pictures.picked) return acts.perform({ kind: "focus", window: search.pictures.picked }, search.selectedRow, stay);
        if (search.ext.submit()) return;
        return acts.doVerb(search.selectedRow ? search.verbsOf(search.selectedRow)[0] : undefined, search.selectedRow, stay);
      case "actions":
      case "presented":
        return acts.doVerb(
          lists.verbs.find((each) => `verb:${each.id}` === lists.selectedVerbId),
          mode.kind === "actions" ? mode.row : undefined,
          stay,
        );
      case "alias": {
        const alias = aliasToKeep(filter);
        if (!alias) return;
        props.prefs?.setAlias(mode.address, alias);
        search.sayDone(`“${alias}” is ${mode.title} now`);
        return acts.backToSearch();
      }
      case "shortcut":
        if (!mode.when || !mayKeep(mode.when, lists.shortcutFound)) return;
        props.prefs?.setKey(mode.address, mode.when);
        search.sayDone("Shortcut kept");
        return acts.backToSearch();
      case "task":
        return acts.agentKeys.submit(lists.heldStep);
      case "grants": {
        if (s.grantsRow === 1) {
          props.handoff?.settings();
          return onClose();
        }
        const request = filter.trim();
        if (!request || !props.handoff) return;
        props.handoff.start({ harness: mode.harness, request, context: chosenContext(s.context, s.chipsOn) }, mode.watch);
        return onClose();
      }
      case "message": {
        const words = filter.trim();
        if (!words) return;
        const run = s.handoff?.runs.find((each) => each.id === mode.run);
        if (props.handoff?.tell(mode.run, words)) {
          s.setFilter("");
          search.sayDone(`Sent to ${run?.harnessName ?? "the agent"}`);
          setTimeout(onClose, 600);
        } else search.sayDone("That agent is gone", false);
        return;
      }
    }
  };
}

/** The compositor's commands for the launcher (launcher/keys.ts). */
function commander(parts: Parts, submit: (stay?: boolean) => void, drawnRows: () => Row[]): (cmd: LauncherCommand) => void {
  const { props, s, search, acts } = parts;
  const { mode, chipsOn } = s;
  const { selectedRow, verbsOf } = search;
  /** The row the keys act on: the action list's row, or the selected one. */
  const target = (): Row | undefined => (mode.kind === "actions" ? mode.row : mode.kind === "search" ? selectedRow : undefined);
  const byKey = (key: string) => {
    const row = target();
    if (row)
      acts.doVerb(
        verbsOf(row).find((each) => each.key === key),
        row,
      );
  };
  const keyed: Partial<Record<LauncherCommand["kind"], string>> = {
    secondary: KEYS.secondary,
    third: KEYS.third,
    copy: KEYS.copy,
    quit: KEYS.quit,
    alias: KEYS.alias,
    shortcut: KEYS.shortcut,
  };
  return (cmd) => {
    const key = keyed[cmd.kind];
    if (key !== undefined) return byKey(key);
    switch (cmd.kind) {
      case "actions":
        return mode.kind === "actions" ? acts.backToSearch() : mode.kind === "search" ? acts.openActions(selectedRow) : undefined;
      case "keep-open":
        return submit(true);
      case "pick": {
        const row = mode.kind === "search" ? drawnRows()[cmd.digit - 1] : undefined;
        if (row) acts.doVerb(verbsOf(row)[0], row);
        return;
      }
      case "digits":
        return s.setDigits(cmd.shown);
      case "record":
        if (mode.kind === "shortcut") s.setMode({ ...mode, when: chordWhen(cmd.chord) });
        return;
      case "tab": {
        // In a scope (the clipboard, snippets, a command from outside) ⇥ asks no one: the rows are the scope's own.
        if (s.scope || search.inOutside || mode.kind === "grants" || mode.kind === "message") return;
        // On a run's row, ⇥ turns the field into words to it.
        const act = selectedRow?.action.kind === "agent" ? selectedRow.action.act : null;
        if (mode.kind === "search" && !search.text && act?.kind === "run") return acts.talkTo(act.run);
        return acts.agentKeys.tab();
      }
      case "option-pick": {
        const harness = mode.kind === "search" ? harnessByDigit(s.handoff, cmd.digit) : null;
        if (harness) acts.handOff(harness, search.text, false);
        return;
      }
      case "stop": {
        const act = selectedRow?.action.kind === "agent" ? selectedRow.action.act : null;
        if (mode.kind === "search" && act?.kind === "run") acts.handoffAct({ kind: "stop-run", run: act.run });
        return;
      }
      case "backspace":
        if (chipsOn.selection) s.setChipsOn({ ...chipsOn, selection: false });
        else if (chipsOn.window) s.setChipsOn({ ...chipsOn, window: false });
        return;
      case "settings":
        if (mode.kind === "grants") {
          props.handoff?.settings();
          props.onClose();
        }
        return;
      case "arrow":
        search.pictures.arrow(cmd.to);
        return;
    }
  };
}

/** New words in the field: the action list's filter, a switch flipped by Space, or a new search. */
function textChanger({ s, search, acts }: Parts): (next: string) => void {
  return (next) => {
    const { query } = s;
    const row = search.selectedRow;
    if (s.mode.kind !== "search") {
      s.setFilter(next);
      s.setHeldVerb(null);
      s.setAsking(null);
      return;
    }
    // Space on a row with a switch flips it, unless it is the next letter of the row's name.
    if (next === `${query} ` && row && spaceFlips(row, query)) {
      const flip = search.verbsOf(row).find((each) => each.key === KEYS.flip);
      if (flip) {
        // The field already shows the space; take it back, so the next letter follows the words.
        acts.setFieldRevision((revision) => revision + 1);
        return acts.perform(flip.effect, row);
      }
    }
    search.restart(next);
  };
}

/** ↑ ↓ move; Esc steps out: the action list or a chip, then All apps, then the typed words, then the launcher. */
function keyHandler({ props, s, search, acts }: Parts): (key: "Escape" | "ArrowUp" | "ArrowDown") => void {
  const { mode, query } = s;
  const { onClose } = props;
  return (key) => {
    if (key === "ArrowDown") return acts.move.current("down");
    if (key === "ArrowUp") return acts.move.current("up");
    // A link opened the launcher for its action alone: Esc closes it. Windows' pictures fold first.
    if (search.pictures.fold()) return;
    if (mode.kind === "presented") return onClose();
    // Esc while an answer is still coming gives up on it (launcher/lib/agents/handlers.ts `leave`).
    if (mode.kind === "task") acts.agentKeys.leave();
    if (mode.kind !== "search") return acts.backToSearch();
    // A command from outside's own scope first, then a launcher scope's chip: back to the whole launcher,
    // or closed when it was opened for the scope.
    if (search.ext.escape()) return;
    if (s.scoped) return s.scoped.alone ? onClose() : acts.enterScope(null);
    if (s.allApps && !query) return s.setAllApps(false);
    if (query) return search.restart("");
    onClose();
  };
}

/** The launcher's keys: Return, the compositor's commands, the field, Esc; and what was typed ahead, played in. */
export function useCommands(parts: Parts, drawnRows: () => Row[]): LauncherKeys {
  const { props, s } = parts;
  const { keys } = props;
  const submit = submitter(parts);
  const command = commander(parts, submit, drawnRows);
  const commands = useRef(command);
  commands.current = command;
  useEffect(() => keys?.subscribeCommands?.((cmd) => commands.current(cmd)), [keys]);
  // Recording ends with the launcher, however it closes.
  useEffect(() => () => keys?.record?.(false), [keys]);
  // A failed ask leaves Now once the launcher closes (it was seen); its history line stays.
  useEffect(() => () => props.agents?.closed?.(), [props.agents]);
  const onChangeText = textChanger(parts);
  const onKey = keyHandler(parts);
  // What was typed before the field had the keyboard, in order (launcher/type-ahead.ts).
  useTypeAhead(props.typeAhead, {
    edit: (edits) => onChangeText(applyEdits(s.mode.kind === "search" ? s.query : s.filter, edits)),
    key: (key) => {
      if (key === "Return") return submit();
      onKey(key === "Up" ? "ArrowUp" : key === "Down" ? "ArrowDown" : "Escape");
    },
  });
  return { submit, onChangeText, onKey };
}

/** The agents' keys the launcher takes now (launcher/keys.ts `ExtraKeys`), told again only when they change. */
export function useExtraKeys(props: LauncherProps, s: LauncherState, search: Search): void {
  const { keys } = props;
  const { mode, handoff, chipsOn } = s;
  const { selectedRow } = search;
  const selectedAct = mode.kind === "search" && selectedRow?.action.kind === "agent" ? selectedRow.action.act : null;
  const extraKeys: ExtraKeys = {
    option: mode.kind === "search" && search.sections.some((section) => section.id === "handoff") && (handoff?.harnesses.length ?? 0) > 1,
    stop: selectedAct?.kind === "run" && selectedRow?.stop === true,
    backspace: search.contextShown && !s.query && (chipsOn.window || chipsOn.selection),
    settings: mode.kind === "grants",
  };
  const extrasKey = JSON.stringify(extraKeys);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the object, which is new each render
  useEffect(() => keys?.extras?.(extraKeys), [keys, extrasKey]);
  useEffect(() => () => keys?.extras?.(NO_EXTRA_KEYS), [keys]);
}
