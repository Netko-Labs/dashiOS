/**
 * The launcher's keys (launcher.tsx): Return in each mode, the compositor's
 * commands (❖K, ❖↩, ❖1–9, ⇥, ⌥1–9, …: launcher/keys.ts), the field's words,
 * Esc stepping out, and what was typed ahead of the field.
 */

import { useEffect, useRef } from "react";
import { type LauncherCommand, NO_EXTRA_KEYS } from "../keys.ts";
import { chordWhen } from "../person-keys.ts";
import type { LauncherProps } from "../props.ts";
import type { Row } from "../row-model.ts";
import { applyEdits } from "../type-ahead.ts";
import { KEYS } from "../verbs.ts";
import { aliasToKeep, mayKeep } from "./editing.ts";
import type { ModeLists } from "./mode.ts";
import { moveSelection } from "./selection.ts";
import { spaceFlips } from "./space-flips.ts";
import type { LauncherState, Search } from "./state.ts";
import { talkSubmit, tries } from "./talk/talk-mode.ts";
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

/** How long the conversation stays after Keep working on it, so its line is read, before the launcher closes. */
export const KEPT_CLOSE_MS = 900;

/** Return in the conversation (lib/talk/talk-mode.ts): the words sent, a question answered, a failure's way on, or a try. */
function talkReturn({ props, s }: Parts): void {
  const dashi = props.dashi;
  if (!dashi) return;
  const choice = talkSubmit(s.talk, s.filter);
  switch (choice.kind) {
    case "send":
      if (dashi.type(choice.text)) s.setFilter("");
      return;
    case "yes":
      dashi.reply({ text: "yes", by: "typing" });
      return;
    case "answer":
      dashi.reply({ text: choice.text, by: "typing" });
      return s.setFilter("");
    case "instead":
      dashi.reply({ text: "no", by: "typing" });
      if (dashi.type(choice.text)) s.setFilter("");
      return;
    case "sign-in":
      props.agents?.signIn();
      return props.onClose();
    case "settings":
      props.agents?.setUp();
      return props.onClose();
    case "none": {
      // The empty view: Return sends the try that is selected.
      const shown = tries(dashi.recent());
      const chosen = s.talk.turns.length === 0 ? shown[Math.min(s.tryAt, shown.length - 1)] : undefined;
      if (chosen) dashi.type(chosen);
    }
  }
}

/** ❖↩ in the conversation: what is typed goes first, then the turn at work goes on by itself and the launcher closes a moment later. */
function keepWorking({ props, s }: Parts): void {
  const dashi = props.dashi;
  if (!dashi) return;
  const words = s.filter.trim();
  if (words && dashi.type(words)) s.setFilter("");
  if (dashi.keepWorking()) setTimeout(props.onClose, KEPT_CLOSE_MS);
}

/** Return: the selected row's first verb, the chosen verb, the alias or key kept, the words to Dashi's agent. */
function submitter({ props, s, search, lists, acts }: Parts): (stay?: boolean) => void {
  const { mode, filter } = s;
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
      case "talk":
        return talkReturn({ props, s, search, lists, acts });
    }
  };
}

/** The compositor's commands for the launcher (launcher/keys.ts). */
function commander(parts: Parts, submit: (stay?: boolean) => void, drawnRows: () => Row[]): (cmd: LauncherCommand) => void {
  const { props, s, search, acts } = parts;
  const { mode } = s;
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
    // In the conversation ❖↩ is Keep working on it, and ❖Esc stops the turn at work.
    if (mode.kind === "talk" && cmd.kind === "secondary") return keepWorking(parts);
    if (cmd.kind === "stop-work") return props.dashi?.stop();
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
        if (s.scope || search.inOutside) return;
        return acts.agentKeys.tab();
      }
      case "arrow":
        // In an extension's grid ← and → step through its cells; elsewhere they are the windows' pictures'.
        if (search.sections.some((section) => section.grid !== undefined && section.rows.some((row) => row.id === search.selected)))
          return s.setHeld((now) =>
            moveSelection(
              search.rows.map((row) => row.id),
              now,
              cmd.to === "right" ? "down" : "up",
            ),
          );
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
    // The conversation: Esc closes the launcher; a turn at work carries on, and the conversation stays open (❖Esc stops it).
    if (mode.kind === "presented" || mode.kind === "talk") return onClose();
    if (mode.kind !== "search") return acts.backToSearch();
    // A command from outside's own scope first, then a launcher scope's chip: back to the whole launcher,
    // or closed when it was opened for the scope.
    if (search.ext.escape()) return;
    // A scope's own step back first: an extension's pushed view, a question in the field.
    if (s.scoped?.scope.back?.()) {
      // Back on the row that was opened, with what was typed then (an extension's pushed view).
      const back = s.scoped.scope.returnTo?.() ?? null;
      search.restart(back?.query ?? "");
      if (back) s.setHeld(back.row);
      return;
    }
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

/** The keys the launcher takes now (launcher/keys.ts `ExtraKeys`), told again only when they change: ❖Esc while a turn works. */
export function useExtraKeys(props: LauncherProps, s: LauncherState): void {
  const { keys } = props;
  const stopWork = s.mode.kind === "talk" && s.talk.working && !s.talk.background;
  useEffect(() => keys?.extras?.({ stopWork }), [keys, stopWork]);
  useEffect(() => () => keys?.extras?.(NO_EXTRA_KEYS), [keys]);
}
