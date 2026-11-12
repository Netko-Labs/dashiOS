/**
 * Settings' cards, in Control Center's language (docs/design.html
 * "Settings"): a card of rows with hairlines between them, a caption over or
 * under it, a line of explanation, a push button, and the surfaces a field
 * sits on. System Settings' panes (settings-app/ui.tsx) and the Installer
 * draw with them.
 */

import { Shortcut, type Surface } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { Children, createContext, Fragment, isValidElement, type ReactNode, useContext, useMemo } from "react";
import { PillButton } from "../controls/inputs.tsx";
import { useControlColors } from "../controls/palette.ts";
import { CardRowsContext, cardRows } from "./edge.ts";

/** A card's corner radius (Settings' PAGE.cardRadius). */
export const CARD_RADIUS = 24;

/** Whether the cards here are lit: a `cards` Spot was asked for (settings-app/spot.tsx). */
export const CardLit = createContext(false);

/**
 * A line pulled 4 closer to the card above it. It keeps the default
 * `flexShrink`: mirin's layout (taffy 0.9) sizes a column wrongly when a
 * child with `flexShrink: 0` has a negative margin, shrinking it by the
 * margin times the child's height, so the page lost its scroll range
 * (Settings' layout rules, test/settings-scroll.test.tsx). In a page,
 * whose height is its content's, nothing shrinks anyway.
 */
export const TUCK = { marginTop: -4 } as const;
/** A space between two words of a caption at 11.5. */
const CAPTION_SPACE = 3;

/** Settings' surfaces, from Control Center's tokens: a text field or a sunk list sits on the window's color. */
export function useSurface(): Surface {
  const colors = useControlColors();
  return { window: colors.window, sidebar: colors.sidebar, card: colors.off, field: colors.window, stripe: colors.surface, canvas: colors.surface };
}

/** A card's rows: fragments opened up, so rows grouped in `<>…</>` get their hairlines too. */
function rowsOf(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? rowsOf(child.props.children) : [child],
  );
}

/** A card of rows, a hairline between them; lit while a link to its section (a `cards` Spot) shows it. Its rows keep one left edge (edge.ts). */
export function Group({ children, testID }: { children: ReactNode; testID?: string }) {
  const colors = useControlColors();
  const lit = useContext(CardLit);
  const rows = rowsOf(children);
  const edge = useMemo(() => cardRows(testID ?? "card"), [testID]);
  return (
    <CardRowsContext.Provider value={edge}>
      <View
        {...(testID !== undefined ? { testID } : {})}
        style={{ flexShrink: 0, flexDirection: "column", borderRadius: CARD_RADIUS, backgroundColor: colors.off, overflow: "hidden" }}
      >
        {/* Always there, so lighting the card never remounts its rows. */}
        <View style={{ flexDirection: "column", backgroundColor: lit ? colors.lit : "#00000000" }}>
          {rows.map((row, index) => (
            // The rows of a card never reorder.
            <Fragment key={index}>
              {index > 0 && <View style={{ height: 1, backgroundColor: colors.line }} />}
              {row}
            </Fragment>
          ))}
        </View>
      </View>
    </CardRowsContext.Provider>
  );
}

/** A row whose label is data, not a setting (a login, a device); a form's field. Settings' own rows are `Setting`s. */

/**
 * A heading over cards, or a sentence under them (tucked 4 closer to the
 * card, `TUCK`); `keys` draws a shortcut after it ("⌥❖D"). With keys the
 * sentence is laid out a word at a time in a row that wraps, the last word
 * and the keys as one piece: in a narrow window the keys stay after the last
 * word, on its line, where a wrapped block of text left them floating at its
 * right, half way up.
 */
export function Caption({ children, above, keys }: { children: string; above?: boolean; keys?: string }) {
  const colors = useControlColors();
  const text = { fontSize: 11.5, fontWeight: above ? "semibold" : "normal", color: colors.muted } as const;
  const place = { ...(above ? ({ flexShrink: 0, marginTop: 6 } as const) : TUCK), paddingLeft: 10, paddingRight: 10 };
  if (!keys) {
    return (
      <View style={place}>
        <Text style={text}>{children}</Text>
      </View>
    );
  }
  const words = children.split(" ").filter(Boolean);
  const last = words.pop() ?? "";
  return (
    <View
      accessibilityLabel={`${children} ${keys}`}
      style={{ ...place, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: CAPTION_SPACE, rowGap: 0 }}
    >
      {words.map((word, index) => (
        // Words have no identity beyond their place in the sentence.
        <Text key={index} style={text}>
          {word}
        </Text>
      ))}
      <View testID="caption-keys" style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <Text style={text}>{last}</Text>
        <Shortcut keys={keys} color={colors.muted} size={11} />
      </View>
    </View>
  );
}

/** A line of explanation, or of nothing to show. */
export function Note({ children, testID }: { children: string; testID?: string }) {
  const colors = useControlColors();
  return (
    <View {...(testID !== undefined ? { testID } : {})} style={{ padding: 16, alignItems: "center" }}>
      <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center" }}>{children}</Text>
    </View>
  );
}

/** A push button: ink for the one that goes ahead (`primary`), ume words for one that can't be undone (`danger`), an outline otherwise. */
export function Button({
  label,
  onPress,
  testID,
  primary,
  danger,
  disabled,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <PillButton label={label} onPress={onPress} testID={testID} tone={danger ? "danger" : primary ? "ink" : "plain"} {...(disabled ? { disabled } : {})} />
  );
}
