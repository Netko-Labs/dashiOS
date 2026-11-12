/**
 * Where the launcher is (launcher.tsx): searching, a row's action list, giving
 * an alias or a key, a link's action, an Ask's plan, the grants card, or words
 * to a run. For each, what the list offers, and what the field shows: its chip,
 * its placeholder and its hints.
 */

import { cut, type HarnessId } from "../../agents/index.ts";
import type { LauncherHost, Presented } from "../host.ts";
import { collision } from "../person-keys.ts";
import type { LauncherPrefsSnapshot } from "../prefs.ts";
import type { Row, RowIcon } from "../row-model.ts";
import type { HandoffSnapshot, LauncherAgentsSnapshot, LauncherScope } from "../types.ts";
import { filterVerbs, hintFor, KEYS, presentedVerbs, type Verb, type VerbContext, verbRow } from "../verbs.ts";
import { ASK_PLACEHOLDER, askHint } from "./agents/agent-rows.ts";
import { handoffHints } from "./agents/handoff-rows.ts";
import type { agentField } from "./agents/task-mode.tsx";
import { aliasRows, shortcutRows } from "./editing.ts";
import type { Extensions } from "./extensions.ts";
import { linkTitle } from "./link-args.ts";
import { placeholderFor } from "./rows.ts";
import { keepInView, resolveSelection } from "./selection.ts";
import type { PicturesState } from "./use-pictures.ts";

/** Where the launcher is: searching, a row's action list, giving an alias or a key, or a link's action. */
export type Mode =
  | { kind: "search" }
  | { kind: "actions"; row: Row }
  | { kind: "alias"; address: string; title: string }
  | { kind: "shortcut"; address: string; title: string; when: string | null }
  | { kind: "presented"; presented: Presented }
  /** An Ask's plan: the field takes a follow-up (launcher/lib/agents/task-mode.tsx). */
  | { kind: "task"; id: string }
  /** The grants card before a task starts: Return starts it (launcher/lib/agents/handoff-views.tsx). */
  | { kind: "grants"; harness: HarnessId; watch: boolean }
  /** Words to a run (⇥ on its row, Follow up): Return sends them. */
  | { kind: "message"; run: string };

/** A link's action waiting for Return, else words to a run, else the search. */
export function initialMode(presented: Presented | null | undefined, talkTo: string | null | undefined): Mode {
  return presented ? { kind: "presented", presented } : talkTo ? { kind: "message", run: talkTo } : { kind: "search" };
}

type Task = LauncherAgentsSnapshot["tasks"][number];

/** What the list holds outside the search: the action list, the alias and shortcut fields' rows, a plan's steps. */
export interface ModeLists {
  verbs: Verb[];
  shortcutFound: ReturnType<typeof collision> | null;
  editRows: Row[];
  verbRows: Row[];
  selectedVerbId: string | null;
  shownVerbs: Row[];
  /** What ↑ and ↓ move through now. */
  listIds: string[];
  /** A plan's step held, or none: a plan's steps start with none selected (↓ selects the first, ↑ the last). */
  heldStep: number | null;
}

interface ListsInput {
  mode: Mode;
  filter: string;
  ctx: VerbContext;
  prefs: LauncherPrefsSnapshot;
  host: LauncherHost | undefined;
  asking: string | null;
  heldVerb: string | null;
  verbOffset: { current: number };
  listRows: number;
  rowIds: string[];
  task: Task | undefined;
  verbsOf: (row: Row) => Verb[];
}

/** The action list, or what the alias and shortcut fields offer; as many of its rows as fit, the selected one in view. */
export function modeLists({ mode, filter, ctx, prefs, host, asking, heldVerb, verbOffset, listRows, rowIds, task, verbsOf }: ListsInput): ModeLists {
  const verbs: Verb[] =
    mode.kind === "actions"
      ? filterVerbs(verbsOf(mode.row), filter)
      : mode.kind === "presented"
        ? filterVerbs(presentedVerbs(mode.presented.action, mode.presented.args, ctx), filter)
        : [];
  const shortcutFound = mode.kind === "shortcut" && mode.when !== null && host ? collision(mode.when, host.keymap(), (bind) => host.describe(bind)) : null;
  const editRows: Row[] =
    mode.kind === "alias"
      ? aliasRows(filter, mode.title, mode.address, prefs.aliases, (address) => host?.describe(address) ?? address)
      : mode.kind === "shortcut"
        ? shortcutRows(mode.when, mode.title, shortcutFound)
        : [];
  const verbRows = verbs.map((each) => verbRow(each, asking === each.id));
  const verbIds = verbRows.map((row) => row.id);
  const selectedVerbId = resolveSelection(verbIds, heldVerb);
  // As many of the action list's rows as fit at the text size, the selected one in view.
  verbOffset.current = keepInView(Math.max(0, verbIds.indexOf(selectedVerbId ?? "")), verbOffset.current, listRows, verbRows.length);
  const shownVerbs = verbRows.slice(verbOffset.current, verbOffset.current + listRows);
  const stepIds = task ? task.steps.map((_, at) => `step:${at}`) : [];
  const listIds = mode.kind === "search" ? rowIds : mode.kind === "task" ? stepIds : verbIds;
  // A plan's steps start with none selected: ↓ selects the first, ↑ the last.
  const heldStep = mode.kind === "task" && heldVerb?.startsWith("step:") && stepIds.includes(heldVerb) ? Number(heldVerb.slice(5)) : null;
  return { verbs, shortcutFound, editRows, verbRows, selectedVerbId, shownVerbs, listIds, heldStep };
}

/** An Ask's plan in the field: its glyph, chip, placeholder and hints (launcher/lib/agents/task-mode.tsx). */
type TaskField = ReturnType<typeof agentField>;

interface FieldInput {
  mode: Mode;
  scope: LauncherScope | null;
  ext: Extensions;
  taskField: TaskField | null;
  messaged: HandoffSnapshot["runs"][number] | undefined;
}

/** The chip at the field's start: the row acted on, the link, the alias or key being given, the run, the plan, the scope. */
export function chipFor({ mode, scope, ext, taskField, messaged }: FieldInput): { title: string; icon?: RowIcon } | undefined {
  return mode.kind === "actions"
    ? { title: mode.row.title, icon: mode.row.icon }
    : mode.kind === "presented"
      ? { title: linkTitle(mode.presented.action, mode.presented.args) }
      : mode.kind === "alias"
        ? { title: `Alias for ${mode.title}` }
        : mode.kind === "shortcut"
          ? { title: `Shortcut for ${mode.title}` }
          : messaged
            ? { title: cut(messaged.request, 32) }
            : (taskField?.chip ?? scope?.chip ?? ext.chip);
}

/** The field's placeholder in each mode; the search's says whether files are looked through, or that Ask is there. */
export function placeholderOf(
  { mode, scope, ext, taskField, messaged }: FieldInput,
  agents: LauncherAgentsSnapshot | null,
  filesShown: boolean,
): string | readonly string[] {
  return mode.kind === "search"
    ? (scope?.placeholder ?? ext.placeholder ?? (agents?.answerer ? ASK_PLACEHOLDER : placeholderFor(filesShown)))
    : taskField
      ? taskField.placeholder
      : mode.kind === "message"
        ? `Tell ${messaged?.harnessName ?? "it"} something`
        : mode.kind === "grants"
          ? "What should it do?"
          : mode.kind === "alias"
            ? "An alias, like ff"
            : mode.kind === "shortcut"
              ? "Press the keys"
              : "Search actions";
}

interface HintsInput extends FieldInput {
  text: string;
  inOutside: boolean;
  selectedRow: Row | undefined;
  ctx: VerbContext;
  pictures: PicturesState;
  agents: LauncherAgentsSnapshot | null;
  handoff: HandoffSnapshot | null;
}

type Hint = { keys: string; label: string };

/** The keys the field's right end names: a row's verbs while searching, else what Return and Esc do here. */
export function hintsOf(input: HintsInput): readonly Hint[] {
  const { mode, scope, taskField, handoff } = input;
  if (mode.kind === "search") return scope ? scope.hints(input.selectedRow) : searchHints(input);
  if (taskField) return taskField.hints;
  if (mode.kind === "grants")
    return [
      { keys: KEYS.primary, label: `Start ${handoff?.harnesses.find((each) => each.id === mode.harness)?.name ?? ""}`.trim() },
      { keys: "Esc", label: "Back" },
    ];
  if (mode.kind === "message")
    return [
      { keys: KEYS.primary, label: "Send" },
      { keys: "Esc", label: "Back" },
    ];
  if (mode.kind === "presented")
    return [
      { keys: "Esc", label: "close" },
      { keys: KEYS.primary, label: "run" },
    ];
  return [{ keys: "Esc", label: "back" }];
}

/** While searching: picking a window's picture, a hand-off's keys, or the selected row's verbs and Ask. */
function searchHints({ pictures, selectedRow, text, ctx, inOutside, agents }: HintsInput): readonly Hint[] {
  if (pictures.picked)
    return [
      { keys: "← →", label: "pick" },
      { keys: KEYS.primary, label: "switch" },
    ];
  return (
    handoffHints(selectedRow) ??
    (text
      ? pictures.count > 0
        ? [{ keys: "→", label: "windows" }, ...hintFor(selectedRow, ctx).slice(0, 2)]
        : [...hintFor(selectedRow, ctx), ...(inOutside ? [] : askHint(text, agents))]
      : [])
  );
}
