/**
 * What the launcher draws for agents from the launcher (docs/actions.md,
 * "Agents from the launcher"): the context chips under the field, and the
 * grants card a task shows once per kind before it starts. No second bar:
 * the chips sit in the panel's own space while the words read as a request,
 * and the hints stay at the field's right end.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type TaskContext, taskGrants, windowWords } from "../../../agents/handoff/grants.ts";
import type { Row } from "../../row-model.ts";
import { useMeasures } from "../measures.ts";
import { ResultRow } from "../row-view.tsx";

/** Which context chips are on. */
export interface ChipsOn {
  window: boolean;
  selection: boolean;
}

/** The chips' row: its pills and the room under them. */
export const CHIPS = { pill: 26, below: 8 } as const;
export const chipsHeight = (scale: number): number => Math.round((CHIPS.pill + CHIPS.below) * scale);

/** The context the task gets: only the chips left on. */
export const chosenContext = (context: TaskContext, on: ChipsOn): TaskContext => ({
  window: on.window ? context.window : null,
  selection: on.selection ? context.selection : null,
});

function Pill({ id, words, on, onPress }: { id: string; words: string; on: boolean; onPress: () => void }) {
  const colors = useColors();
  const m = useMeasures();
  return (
    <View
      testID={`launcher:context:${id}`}
      onPress={onPress}
      style={{
        flexShrink: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: Math.round(CHIPS.pill * m.textSize),
        paddingLeft: 9,
        paddingRight: 9,
        borderRadius: Math.round((CHIPS.pill * m.textSize) / 2),
        borderWidth: 1,
        borderColor: on ? colors.selectionBar : colors.separator,
        backgroundColor: on ? colors.selectionWash : colors.button,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: m.detail, color: on ? colors.text : colors.textMuted }}>
        {`＋ ${words}`}
      </Text>
      {on && <Text style={{ fontSize: m.detail, color: colors.textMuted }}>×</Text>}
    </View>
  );
}

/** "＋ Helium · bodytech.com.co ×" from the window in front (on until dropped), "＋ Selection" when something is selected. */
export function ContextChips({ context, on, onToggle }: { context: TaskContext; on: ChipsOn; onToggle: (which: keyof ChipsOn) => void }) {
  const m = useMeasures();
  if (!context.window && !context.selection) return null;
  return (
    <View
      testID="launcher:context"
      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 16, paddingRight: 16, paddingBottom: Math.round(CHIPS.below * m.textSize) }}
    >
      {context.window && <Pill id="window" words={windowWords(context.window)} on={on.window} onPress={() => onToggle("window")} />}
      {context.selection && <Pill id="selection" words="Selection" on={on.selection} onPress={() => onToggle("selection")} />}
    </View>
  );
}

/** The card's second row: Settings › Agents. */
export const CHANGE_ROW: Row = {
  id: "grants:change",
  title: "Change what it may use…",
  kind: "",
  shortcut: "❖,",
  icon: { none: true },
  action: { kind: "agent", act: { kind: "set-up" } },
};

/**
 * "Claude Code will work on this in Dashi's sandbox": what it may use, from
 * the sandbox's real limits, struck through what it can't.
 */
export function GrantsCard({
  harness,
  context,
  selected,
  onStart,
  onChange,
  onHover,
}: {
  harness: string;
  context: TaskContext;
  /** 0: the card (Return starts), 1: Change what it may use…. */
  selected: 0 | 1;
  onStart: () => void;
  onChange: () => void;
  onHover: (row: 0 | 1) => void;
}) {
  const colors = useColors();
  const m = useMeasures();
  const lines = taskGrants(context);
  const isSelected = selected === 0;
  const ink = isSelected ? colors.onSelection : colors.text;
  const quiet = isSelected ? colors.onSelection : colors.textMuted;
  return (
    <View testID="launcher:section:grants" style={{ flexDirection: "column" }}>
      <View
        testID="launcher:grants"
        onPress={onStart}
        onHoverChange={(hovered) => hovered && onHover(0)}
        style={{
          flexDirection: "column",
          gap: 6,
          paddingTop: 9,
          paddingBottom: 10,
          paddingLeft: 12,
          paddingRight: 12,
          borderRadius: 7,
          ...(isSelected ? { backgroundColor: colors.selectionWash } : {}),
        }}
      >
        <Text style={{ fontSize: m.title, fontWeight: "semibold", color: ink }}>{`${harness} will work on this in Dashi's sandbox`}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {lines.map((line) => (
            <View
              key={line.id}
              testID={`launcher:grant:${line.id}`}
              style={{
                paddingLeft: 7,
                paddingRight: 7,
                height: Math.round(18 * m.textSize),
                borderRadius: 9,
                justifyContent: "center",
                backgroundColor: colors.button,
              }}
            >
              <Text style={{ fontSize: m.small, color: line.allowed ? ink : quiet, ...(line.allowed ? {} : { textDecorationLine: "line-through" as const }) }}>
                {line.words}
              </Text>
            </View>
          ))}
        </View>
        <Text style={{ fontSize: m.detail, color: quiet }}>It never sees your passwords: Dashi types them. You can stop it from the menu bar.</Text>
      </View>
      <ResultRow row={CHANGE_ROW} selected={selected === 1} onPress={onChange} onHover={() => onHover(1)} />
    </View>
  );
}
