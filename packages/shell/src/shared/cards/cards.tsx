/**
 * Settings' cards, in Control Center's language (docs/design.html
 * "Settings"): a card of rows with hairlines between them, a caption over or
 * under it, a line of explanation, a push button, and the surfaces a field
 * sits on. System Settings' panes (settings-app/ui.tsx) and the Installer
 * draw with them.
 */

import { CLEAR, KeyedText, Button as KitButton, RADIUS, Shortcut, SPACE, type Surface, TYPE, useControlColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { Children, createContext, Fragment, isValidElement, type ReactNode, useContext, useMemo } from "react";
import { CardRowsContext, cardRows } from "./edge.ts";

/** A card's corner radius (Settings' PAGE.cardRadius). */
export const CARD_RADIUS = RADIUS.panelCard;

/** Where a card's words start: its rows' edge, 16 in (SE-9; Settings' PAGE.inset). */
export const CARD_INSET = SPACE.page;

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
export const TUCK = { marginTop: -SPACE.xs } as const;
/** A space between two words of a caption at 11.5. */
const CAPTION = { space: 3, above: SPACE.s } as const;

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

/** Rows with a hairline between them. */
function Hairlined({ rows }: { rows: ReactNode[] }) {
  const colors = useControlColors();
  return rows.map((row, index) => (
    // The rows of a card never reorder.
    <Fragment key={index}>
      {index > 0 && <View style={{ height: 1, backgroundColor: colors.line }} />}
      {row}
    </Fragment>
  ));
}

/** How a card's pressable rows are one Tab stop: a `listbox` you pick one row from, or a `list` of things. */
export type RowListRole = "listbox" | "list";

const focusGroupOf = (role: RowListRole | undefined) => (role !== undefined ? { focusGroup: true, accessibilityRole: role } : {});

/**
 * A card of rows, a hairline between them; lit while a link to its section
 * (a `cards` Spot) shows it. Its rows keep one left edge (edge.ts). A card
 * of pressable rows (`list`) is one Tab stop the arrows move through.
 */
export function Group({ children, testID, list }: { children: ReactNode; testID?: string; list?: RowListRole }) {
  const colors = useControlColors();
  const lit = useContext(CardLit);
  const edge = useMemo(() => cardRows(testID ?? "card"), [testID]);
  return (
    <CardRowsContext.Provider value={edge}>
      <View
        {...(testID !== undefined ? { testID } : {})}
        {...focusGroupOf(list)}
        style={{ flexShrink: 0, flexDirection: "column", borderRadius: CARD_RADIUS, backgroundColor: colors.off, overflow: "hidden" }}
      >
        {/* Always there, so lighting the card never remounts its rows. */}
        <View style={{ flexDirection: "column", backgroundColor: lit ? colors.lit : CLEAR }}>
          <Hairlined rows={rowsOf(children)} />
        </View>
      </View>
    </CardRowsContext.Provider>
  );
}

/** Some of a card's rows as one Tab stop (a list under a setting's row), hairlines kept between them. */
export function RowList({ children, testID, role }: { children: ReactNode; testID?: string; role: RowListRole }) {
  return (
    <View {...(testID !== undefined ? { testID } : {})} {...focusGroupOf(role)} style={{ flexDirection: "column" }}>
      <Hairlined rows={rowsOf(children)} />
    </View>
  );
}

/** A row whose label is data, not a setting (a login, a device); a form's field. Settings' own rows are `Setting`s. */

/**
 * A heading over cards (11.5 SemiBold muted), or a sentence under them
 * (tucked 4 closer to the card, `TUCK`), on the rows' 16 edge (SE-9); `keys` draws a shortcut after it ("⌥❖D"). With keys the
 * sentence is laid out a word at a time in a row that wraps, the last word
 * and the keys as one piece: in a narrow window the keys stay after the last
 * word, on its line, where a wrapped block of text left them floating at its
 * right, half way up.
 */
export function Caption({ children, above, keys }: { children: string; above?: boolean; keys?: string }) {
  const colors = useControlColors();
  const text = { fontSize: TYPE.panel.detail.size, fontWeight: above ? WEIGHT.semibold : WEIGHT.regular, color: colors.muted } as const;
  const place = { ...(above ? ({ flexShrink: 0, marginTop: CAPTION.above } as const) : TUCK), paddingLeft: CARD_INSET, paddingRight: CARD_INSET };
  if (!keys) {
    return (
      <View style={place}>
        {/* A sentence may name keys in its words ("the right ⌥"): drawn at the text's size. */}
        <KeyedText style={text}>{children}</KeyedText>
      </View>
    );
  }
  const words = children.split(" ").filter(Boolean);
  const last = words.pop() ?? "";
  return (
    <View
      accessibilityLabel={`${children} ${keys}`}
      style={{ ...place, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: CAPTION.space, rowGap: 0 }}
    >
      {words.map((word, index) => (
        // Words have no identity beyond their place in the sentence.
        <Text key={index} style={text}>
          {word}
        </Text>
      ))}
      <View testID="caption-keys" style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, flexShrink: 0 }}>
        <Text style={text}>{last}</Text>
        <Shortcut keys={keys} color={colors.muted} size={TYPE.caption.size} />
      </View>
    </View>
  );
}

/** A card's "nothing here" or "still looking" (SE-9): never a failure, which is `Failure`. */
export function Note({ children, testID }: { children: string; testID?: string }) {
  const colors = useControlColors();
  return (
    <View {...(testID !== undefined ? { testID } : {})} style={{ padding: CARD_INSET, alignItems: "center" }}>
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.muted, textAlign: "center" }}>{children}</Text>
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
    <KitButton
      look="panel"
      label={label}
      onPress={onPress}
      testID={testID}
      primary={primary === true && !danger}
      danger={danger === true}
      {...(disabled ? { disabled } : {})}
    />
  );
}
