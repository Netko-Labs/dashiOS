/**
 * The launcher (❖Space or a tap of ❖): a search field over installed apps,
 * Settings panes and settings, open windows, Dashi's commands, the menus of
 * running apps, files (through LocalSearch), and sums. What it lists is
 * launcher/lib/rows.ts, ranked by launcher/ranking/ over launcher/lib/items.ts; what
 * a row can do is launcher/verbs.ts; how the selection moves is
 * launcher/lib/selection.ts.
 *
 * - The selection is a row's id: files that land late never put another row
 *   under it, and Enter acts on the row highlighted when it is pressed.
 * - ↑ ↓ (and ⌃P ⌃N) wrap; Page Up and Page Down, Home and End (launcher/keys.ts);
 *   the pointer over a row selects it. Esc steps out: the action list or a
 *   chip, then the typed words, then the launcher.
 * - ↩ does the row's thing, ⇧↩ and stays open; ❖↩ and ⌥↩ the second and
 *   third (New window, Bring here, Show in Files), ❖C copies, ❖1–9 picks a
 *   row (the digits show while ❖ is held).
 * - ❖K or a right-click turns the rows into the selected row's actions, in
 *   place: the chip names it, typing filters, Esc goes back.
 * - Space on a setting with a switch flips it; Enter opens Settings there.
 * - A sum is the first row: Enter copies it, and it says so in place.
 * - Nothing found offers Did you mean, Search files, and Find in Software.
 * - With nothing typed: Recent, else a few things to try, then All apps.
 * - → on a row with windows shows them live under it; ← → pick, ↩ switches (launcher/pictures.ts).
 * - Type and rows grow with the text size (launcher/lib/measures.ts); a screen reader hears the field,
 *   the rows and the selection (launcher/access.ts).
 * - A scope (launcher/types.ts: the clipboard history at ⌥❖V, snippets)
 *   narrows the panel to its rows behind a chip; Esc leaves it.
 */

import { useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { fieldAccess } from "./access.ts";
import { useCommands, useExtraKeys } from "./lib/commands.ts";
import { Field } from "./lib/field.tsx";
import { drawnSections, listFor } from "./lib/list.tsx";
import { PANEL, SURFACE, useMeasures } from "./lib/measures.ts";
import { chipFor, hintsOf, modeLists, placeholderOf } from "./lib/mode.ts";
import { TalkPanel } from "./lib/talk/panel.tsx";
import { useActs } from "./lib/use-acts.ts";
import { useLauncherState, useSearch } from "./lib/use-search.ts";
import type { LauncherProps } from "./props.ts";

/** The surface, and the measures of the panel on it at text size 1 (docs/design.html LA-1, TY-1, RA-1: the launcher's row; launcher/lib/measures.ts). */
export const LAUNCHER = { ...SURFACE, top: 120, field: 48, fieldText: 17, radius: PANEL.radius, padding: PANEL.padding } as const;

/**
 * The launcher: its state and search (launcher/lib/use-search.ts), what each mode lists and shows in the field
 * (launcher/lib/mode.ts), what it does (launcher/lib/use-acts.ts, launcher/lib/perform.ts), its keys
 * (launcher/lib/commands.ts) and its list (launcher/lib/list.tsx).
 */
export function Launcher(props: LauncherProps) {
  const colors = useColors();
  // Type and rows at the person's text size, and how many rows fit (launcher/lib/measures.ts).
  const m = useMeasures();
  const s = useLauncherState(props);
  const search = useSearch(props, s, m);
  const { mode, filter } = s;
  const lists = modeLists({
    ...{ mode, filter, ctx: search.ctx, prefs: s.prefs, host: props.host, asking: s.asking, heldVerb: s.heldVerb, verbOffset: s.verbOffset },
    ...{ listRows: m.listRows, rowIds: search.rows.map((row) => row.id), verbsOf: search.verbsOf },
  });
  const acts = useActs(props, s, search, lists);
  const { onScreen, drawnRows } = drawnSections(s, search, m);
  const keys = useCommands({ props, s, search, lists, acts }, drawnRows);
  useExtraKeys(props, s);
  const list = listFor({ props, s, search, lists, acts, keys, m, colors, onScreen, drawnRows });
  const field = { mode, scope: s.scope, ext: search.ext };
  const chip = chipFor(field);
  const placeholder = placeholderOf(field, s.agents, props.files !== undefined && !s.filesOff);
  const hints = hintsOf({ ...field, ...search, agents: s.agents });
  const access = props.accessible === true;
  return (
    // The focus ring is kombu in every control inside (KB-2).
    <View testID="launcher-root" style={{ flex: 1, flexDirection: "column", alignItems: "center", focusRingColor: colors.focusRing }}>
      {/* A click anywhere outside the panel closes the launcher. */}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={props.onClose} />
      <View
        occlude
        style={{
          width: LAUNCHER.width,
          flexDirection: "column",
          borderRadius: LAUNCHER.radius,
          // The conversation's thread is read over whatever window is under it: its glass is the launcher's colour, solid (D261).
          backgroundColor: mode.kind === "talk" ? colors.launcher.slice(0, 7) : colors.launcher,
          borderWidth: 1,
          borderColor: colors.separator,
          shadow: "xl",
          overflow: "hidden",
        }}
      >
        {mode.kind === "talk" ? (
          // The conversation (lib/talk/): the thread, then the field at the bottom.
          <TalkPanel props={props} s={s} keys={keys} revision={acts.fieldRevision} colour={props.colour ?? colors.agent} />
        ) : (
          <>
            <Field
              value={mode.kind === "search" ? s.query : filter}
              revision={acts.fieldRevision}
              placeholder={placeholder}
              {...(chip ? { chip } : {})}
              hints={hints}
              notice={s.notice}
              {...(access ? { access: { ...fieldAccess(typeof placeholder === "string" ? placeholder : (placeholder[0] ?? ""), list !== null) } } : {})}
              onChangeText={keys.onChangeText}
              onSubmit={() => keys.submit()}
              onKey={keys.onKey}
            />
            {list}
          </>
        )}
      </View>
    </View>
  );
}
