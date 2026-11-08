/**
 * What the panes are built from, in Control Center's language (the approved
 * design, docs/design.html "Settings"): a page whose title is the content's
 * one 56-tall row ("Displays · Built-in"), an optional hero (a picture of
 * what the pane controls), then cards (radius 24, the off tile's color) of
 * 56-tall rows, a row's glyph on a round knob, hairlines between them.
 * Choices are segmented pills, sliders the ink flat slider, switches show
 * their track when off, and a button that goes ahead is ink: green only ever
 * means "on". Everything paints with the live Dark Mode.
 */

import { Shortcut, type Surface, Tile, useColors } from "@dashi/ui";
import { type Bounds, ScrollView, Text, View } from "@mirinjs/metal";
import { Children, createContext, Fragment, isValidElement, type ReactNode, useContext, useMemo, useRef } from "react";
import { InkSlider } from "../shared/controls/ink-slider.tsx";
import { ControlSwitch, PillButton, Segmented } from "../shared/controls/inputs.tsx";
import { useControlColors } from "../shared/controls/palette.ts";
import { PAGE } from "./row.tsx";
import { LIT_WASH, PAGE_GAP, PageContext, SpotLit } from "./spot.tsx";

export { Tile };

export { PAGE } from "./row.tsx";
export { Setting } from "./setting.tsx";
export { Spot } from "./spot.tsx";

/** A page's content is at most this wide, centered in a wider window (LA-2). */
export const PAGE_MAX_WIDTH = 720;

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

/** A card of rows, a hairline between them; lit while a link to its section (a `cards` Spot) shows it. */
export function Group({ children, testID }: { children: ReactNode; testID?: string }) {
  const colors = useControlColors();
  const lit = useContext(SpotLit);
  const rows = rowsOf(children);
  return (
    <View
      {...(testID !== undefined ? { testID } : {})}
      style={{ flexShrink: 0, flexDirection: "column", borderRadius: PAGE.cardRadius, backgroundColor: colors.off, overflow: "hidden" }}
    >
      {/* Always there, so lighting the card never remounts its rows. */}
      <View style={{ flexDirection: "column", backgroundColor: lit ? LIT_WASH : "#00000000" }}>
        {rows.map((row, index) => (
          // The rows of a card never reorder.
          <Fragment key={index}>
            {index > 0 && <View style={{ height: 1, backgroundColor: colors.line }} />}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

/** A hero: a picture of what the pane controls (the themes, the display, the battery, the panel), on a card with rounder corners. */
export function Hero({ children, testID, padding = 14 }: { children: ReactNode; testID?: string; padding?: number }) {
  const colors = useControlColors();
  return (
    <View
      {...(testID !== undefined ? { testID } : {})}
      style={{ flexShrink: 0, flexDirection: "row", alignItems: "stretch", gap: 12, padding, borderRadius: PAGE.heroRadius, backgroundColor: colors.off }}
    >
      {children}
    </View>
  );
}

/** A row whose label is data, not a setting (a login, a device); a form's field. Settings' own rows are `Setting`s. */
export { Row as FormRow, Row as Item, Row, type RowProps } from "./row.tsx";

/** A heading over cards, or a sentence under them; `keys` draws a shortcut after it ("⌥❖D"). */
export function Caption({ children, above, keys }: { children: string; above?: boolean; keys?: string }) {
  const colors = useControlColors();
  return (
    <View
      style={{
        flexShrink: 0,
        paddingLeft: 10,
        paddingRight: 10,
        marginTop: above ? 6 : -4,
        ...(keys ? { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4 } : {}),
      }}
    >
      <Text style={{ fontSize: 11.5, fontWeight: above ? "semibold" : "normal", color: colors.muted }}>{children}</Text>
      {keys ? <Shortcut keys={keys} color={colors.muted} size={11} /> : null}
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

export interface Choice<T> {
  value: T;
  label: string;
}

/** Choices as segmented pills, the chosen one green with the tighter corner. */
export function Choices<T extends string | number>(props: {
  options: ReadonlyArray<Choice<T>>;
  value: T;
  onChange: (value: T) => void;
  testID: string;
  disabled?: boolean;
}) {
  return <Segmented {...props} />;
}

/** A setting's slider: Control Center's flat ink slider, its glyph on a chip and its value at the right. */
export function Slider(props: {
  value: number;
  range?: { min: number; max: number; step: number };
  width?: number;
  testID: string;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  glyph?: string;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  return <InkSlider {...props} />;
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

/** An on/off switch: its track shows when off, Dashi green when on. */
export function Switch({ on, testID, onChange, disabled }: { on: boolean; testID: string; onChange?: (on: boolean) => void; disabled?: boolean }) {
  return <ControlSwitch on={on} testID={testID} {...(onChange ? { onChange } : {})} {...(disabled ? { disabled } : {})} />;
}

/** The settings file couldn't be written just now (view.tsx provides it; the page says so at its top). */
export const SaveError = createContext(false);

/** The title row: the pane's name, 18 SemiBold, and an optional "· detail"; where the window is grabbed on this side. */
function TitleRow({ title, detail }: { title: string; detail?: string | undefined }) {
  const colors = useControlColors();
  return (
    <View
      testID="settings-title"
      dragRegion
      style={{ height: PAGE.title, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: PAGE.margin, paddingRight: PAGE.margin }}
    >
      <View style={{ flexShrink: 0 }}>
        <Text style={{ fontSize: 18, fontWeight: "semibold", color: colors.text }}>{title}</Text>
      </View>
      {detail !== undefined && detail !== "" && (
        <View testID="settings-title-detail" style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 12.5, color: colors.muted }}>{`· ${detail}`}</Text>
        </View>
      )}
      <View style={{ flex: 1 }} />
    </View>
  );
}

/**
 * A pane: its title row, then its hero and cards, scrolling under the title
 * when taller than the window, at most `PAGE_MAX_WIDTH` wide. When the last
 * change couldn't be saved, the page says so first, in plain words (PA-6).
 */
export function Page({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  const { critical } = useColors();
  const unsaved = useContext(SaveError);
  const testID = `pane:${title}`;
  // Where the page is, so a row asked for by its address can be scrolled to (spot.tsx).
  const bounds = useRef<Bounds | null>(null);
  const page = useMemo(() => ({ testID, bounds }), [testID]);
  return (
    <PageContext.Provider value={page}>
      <View style={{ flex: 1, flexDirection: "column", minHeight: 0 }}>
        <TitleRow title={title} detail={detail} />
        <ScrollView
          testID={testID}
          onLayout={(laid) => {
            bounds.current = laid;
          }}
          style={{ flex: 1, flexDirection: "column", paddingLeft: PAGE.margin, paddingRight: PAGE.margin, paddingBottom: PAGE.margin }}
        >
          <View style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH, alignSelf: "center", flexDirection: "column", gap: PAGE_GAP }}>
            {unsaved && (
              <View testID="settings-error" style={{ paddingLeft: 10, paddingRight: 10 }}>
                <Text style={{ fontSize: 12, color: critical }}>
                  Your last change couldn't be saved. Check that your home folder has free space, then try again.
                </Text>
              </View>
            )}
            {children}
          </View>
        </ScrollView>
      </View>
    </PageContext.Provider>
  );
}
