/**
 * One launcher row and one section head, on Dashi's measures (docs/design.html
 * LA-1, TY-1, RA-1): rows 40 tall with 28 px icons, a 7 px radius inside the
 * panel's 5 px padding and 12 px corners, the name at 13, what follows it at
 * 12, the kind at 11, all times the person's text size (measures.ts). One
 * line each (VS-2), except a question asked in place (an add-on's "Get …?",
 * which says what it can reach): it wraps, and the row grows to hold it. The selected row is a kombu wash behind ink, with a 3 px
 * kombu bar at its left edge (CO-6).
 *
 * At the right end a row shows one thing: a setting's control (its switch,
 * which Space flips, or its value), else the key that does it (a menu
 * item's shortcut, a verb's key, the digit ❖ picks it with while ❖ is held),
 * else its kind. Keys are drawn as glyphs (@dashi/ui Shortcut).
 */

import { KEY_GLYPHS, type Palette, Shortcut, Switch, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { AppIcon } from "../../shared/apps/index.ts";
import type { Row, RowIcon, Tone } from "../row-model.ts";
import { type Measures, STANDARD, useMeasures } from "./measures.ts";

export const ROW_HEIGHT = STANDARD.row;
export const HEAD_HEIGHT = STANDARD.head;
const BAR = { width: 3, height: 20 };
/** Left of a row's name: its padding, icon, and the gap after it. */
export const nameIndent = (m: Measures): number => 10 + m.icon + 10;

/** Above and below a wrapped question, so its lines sit in the row as one line sits in a 40 one. */
const QUESTION_PAD = 9;

/** Beside a long name (an extension's item), its words after it take at most this much, so the name is read first. */
const DETAIL_BESIDE_LONG = 220;
/** An agent's dot on its row's icon (Now), 6 across. */
const DOT = 6;
/** The stop square at a running agent's right end, as the menu bar's pill draws it. */
const STOP = 9;

/** A tone's ink (an extension's tag or glyph); on the selection's wash, the selection's ink. */
export const toneInk = (colors: Palette, tone: Tone | undefined): string =>
  tone === "moss"
    ? colors.moss
    : tone === "ume"
      ? colors.criticalInk
      : tone === "broth"
        ? colors.broth
        : tone === "accent"
          ? colors.accentInk
          : tone === "secondary" || tone === "tertiary"
            ? colors.textMuted
            : colors.text;

function Icon({ icon, m, agent }: { icon: RowIcon; m: Measures; agent?: Row["agent"] }) {
  const colors = useColors();
  if ("none" in icon) return null;
  if ("image" in icon) return <AppIcon source={icon.image} style={{ width: m.icon, height: m.icon }} />;
  // An emoji is its own picture: no tile behind it.
  if ("text" in icon)
    return (
      <View style={{ width: m.icon, height: m.icon, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: m.glyph + 2 }}>{icon.text}</Text>
      </View>
    );
  // A pane's own glyph in ink on a neutral tile: never tinted (CO-2, CO-4). Only Ask's glyph is shiso (CO-3).
  return (
    <View
      style={{ width: m.icon, height: m.icon, borderRadius: m.icon * 0.24, alignItems: "center", justifyContent: "center", backgroundColor: colors.button }}
    >
      <Svg markup={icon.glyph} size={m.glyph} color={agent === "ask" ? colors.agent : toneInk(colors, icon.tone)} />
      {agent === "dot" && (
        <View
          testID="launcher:agent-dot"
          style={{ position: "absolute", right: -1, bottom: -1, width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: colors.agent }}
        />
      )}
    </View>
  );
}

function StopSquare({ id, onStop }: { id: string; onStop: () => void }) {
  const colors = useColors();
  return (
    <View
      testID={`launcher:stop:${id}`}
      accessibilityRole="button"
      accessibilityLabel="Stop"
      onPress={onStop}
      style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}
    >
      <View style={{ width: STOP, height: STOP, borderRadius: 2, backgroundColor: colors.agentInk }} />
    </View>
  );
}

/** An extension's tags at a row's right end, each in its tone's ink (the selection's ink on the wash). */
function Tags({ tags, selected, m }: { tags: NonNullable<Row["tags"]>; selected: boolean; m: Measures }) {
  const colors = useColors();
  return (
    <>
      {tags.map((tag) => (
        <View
          key={tag.text}
          style={{
            flexShrink: 0,
            paddingLeft: 6,
            paddingRight: 6,
            height: Math.round(m.small * 1.6),
            borderRadius: 5,
            justifyContent: "center",
            backgroundColor: colors.button,
          }}
        >
          <Text style={{ fontSize: m.small, color: selected ? colors.onSelection : toneInk(colors, tag.tone) }}>{tag.text}</Text>
        </View>
      ))}
    </>
  );
}

/** The right end: an extension's tags, then the one thing a row shows there; it never gives way. */
function RowEnd({ row, digit, quiet, selected, m }: { row: Row; digit: number | undefined; quiet: string; selected: boolean; m: Measures }) {
  return (
    <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 10 }}>
      {row.tags && <Tags tags={row.tags} selected={selected} m={m} />}
      <RightEnd row={row} digit={digit} quiet={quiet} m={m} />
    </View>
  );
}

export interface ResultRowProps {
  row: Row;
  selected: boolean;
  onPress: () => void;
  onHover: () => void;
  /** Right-click: the row's action list. */
  onContextMenu?: () => void;
  /** ❖ is held: the digit that picks this row (1–9). */
  digit?: number;
  /** The stop square of a row that has one (`row.stop`). */
  onStop?: () => void;
  /** Props for the accessibility tree (access.ts); none on a host without one. */
  access?: Record<string, unknown>;
}

/** What the right end shows (see the module comment). */
function RightEnd({ row, digit, quiet, m }: { row: Row; digit: number | undefined; quiet: string; m: Measures }) {
  if (digit !== undefined) return <Shortcut keys={`❖${digit}`} color={quiet} size={m.small} />;
  if (row.control?.kind === "switch") return <Switch testID={`launcher:switch:${row.id}`} on={row.control.on} />;
  if (row.control?.kind === "value") return <Text style={{ fontSize: m.detail, color: quiet }}>{row.control.text}</Text>;
  if (row.shortcut) return <Shortcut keys={row.shortcut} color={quiet} size={m.small} />;
  if (row.kind !== "") return <Text style={{ fontSize: m.small, color: quiet }}>{row.kind}</Text>;
  return null;
}

/** The selected row's 3 px bar at its left edge (CO-6), centred on a row's height (a question's first line). */
function SelectionBar({ m }: { m: Measures }) {
  const colors = useColors();
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        top: (m.row - BAR.height) / 2,
        width: BAR.width,
        height: BAR.height,
        borderRadius: 1.5,
        backgroundColor: colors.selectionBar,
      }}
    />
  );
}

/** A row's name: one line, or a question's words wrapped. An extension's name may be long (a pull request's title): it gives way too, with its words after it. */
function Title({ row, ink, m }: { row: Row; ink: string; m: Measures }) {
  return (
    <View style={row.long || row.question ? { flexShrink: 1, minWidth: 0 } : { flexShrink: 0 }}>
      <Text
        {...(row.question ? {} : { numberOfLines: 1 as const })}
        style={{
          fontSize: m.title,
          color: ink,
          ...(row.question ? { lineHeight: Math.round(m.title * 1.38) } : {}),
          ...(row.strong ? { fontWeight: "semibold" } : {}),
        }}
      >
        {row.title}
      </Text>
    </View>
  );
}

export function ResultRow({ row, selected, onPress, onHover, onContextMenu, digit, onStop, access }: ResultRowProps) {
  const colors = useColors();
  const m = useMeasures();
  // On the wash every word is ink: muted ink there would fall under 4.5:1. A destructive row stays red, selected or not.
  // Ask's words are shiso until it is selected: then they are the selection's ink, like any row's.
  const ink = row.danger ? colors.criticalInk : selected ? colors.onSelection : row.agent === "ask" ? colors.agentInk : colors.text;
  const quiet = selected ? colors.onSelection : colors.textMuted;
  return (
    <View
      testID={`launcher:row:${row.id}`}
      onPress={onPress}
      onHoverChange={(hovered) => {
        if (hovered) onHover();
      }}
      {...(onContextMenu ? { onContextMenu } : {})}
      {...(access ?? {})}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        // A question wraps: the row grows with it (the list follows its rows' height), and its key stays at the right end.
        ...(row.question ? { minHeight: m.row, paddingTop: QUESTION_PAD, paddingBottom: QUESTION_PAD } : { height: m.row }),
        paddingLeft: 10,
        paddingRight: 12,
        borderRadius: 7,
        // One mark only: the pointer moves the selection, so a row has no hover tint of its own.
        ...(selected ? { backgroundColor: colors.selectionWash } : {}),
      }}
    >
      {selected && <SelectionBar m={m} />}
      <Icon icon={row.icon} m={m} {...(row.agent ? { agent: row.agent } : {})} />
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Title row={row} ink={ink} m={m} />
        {row.chord !== undefined && <Shortcut keys={row.chord} color={ink} size={m.detail} />}
        {row.badge !== undefined && (
          <View
            testID={`launcher:badge:${row.id}`}
            style={{
              flexShrink: 0,
              paddingLeft: 5,
              paddingRight: 5,
              height: Math.round(m.small * 1.45),
              borderRadius: 4,
              justifyContent: "center",
              backgroundColor: colors.button,
            }}
          >
            <Text style={{ fontSize: m.small, color: ink }}>{row.badge}</Text>
          </View>
        )}
        {row.detail !== undefined && (
          <View style={{ flexShrink: 1, minWidth: 0, ...(row.long ? { maxWidth: DETAIL_BESIDE_LONG } : {}) }}>
            <Text numberOfLines={1} style={{ fontSize: m.detail, color: row.attention && !selected ? colors.broth : quiet }}>
              {row.detail}
            </Text>
          </View>
        )}
      </View>
      <RowEnd row={row} digit={digit} quiet={quiet} selected={selected} m={m} />
      {row.stop && onStop && <StopSquare id={row.id} onStop={onStop} />}
      {row.more && <Svg markup={KEY_GLYPHS["→"] ?? ""} size={m.detail} color={quiet} />}
    </View>
  );
}

/** Slots held for rows still coming: the panel keeps its height, and the rows fill in without moving anything. */
export function ReservedRows({ count }: { count: number }) {
  const m = useMeasures();
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={{ height: m.row }} />
      ))}
    </>
  );
}

export function SectionHead({ title, aside }: { title: string; aside?: string }) {
  const colors = useColors();
  const m = useMeasures();
  return (
    <View style={{ height: m.head, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 12, gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: m.small, fontWeight: "semibold", color: colors.textMuted }}>
          {title}
        </Text>
      </View>
      {aside !== undefined && <Text style={{ fontSize: m.small, color: colors.textMuted }}>{aside}</Text>}
    </View>
  );
}
