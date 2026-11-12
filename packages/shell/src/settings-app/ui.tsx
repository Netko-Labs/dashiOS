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

import { useColors } from "@dashi/ui";
import { type Bounds, ScrollView, Text, useWindowChrome, View } from "@mirinjs/metal";
import { createContext, type ReactNode, useContext, useMemo, useRef } from "react";
import { FoldedChoices } from "../shared/controls/folded.tsx";
import { InkSlider } from "../shared/controls/ink-slider.tsx";
import { ControlSwitch } from "../shared/controls/inputs.tsx";
import { useControlColors } from "../shared/controls/palette.ts";
import { PAGE } from "./lib/row.tsx";
import { PAGE_GAP, PageContext } from "./spot.tsx";

/** A page's content is at most this wide, centered in a wider window (LA-2). */
export const PAGE_MAX_WIDTH = 720;

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

export interface Choice<T> {
  value: T;
  label: string;
}

/**
 * Choices as segmented pills, the chosen one green with the tighter corner;
 * past five, the four commonest (`common`, else the first four) and "More"
 * for the rest, the one in use always among the pills (shared/controls/fold.ts).
 */
export function Choices<T extends string | number>(props: {
  options: ReadonlyArray<Choice<T>>;
  value: T;
  onChange: (value: T) => void;
  testID: string;
  disabled?: boolean;
  common?: readonly T[];
}) {
  return <FoldedChoices {...props} />;
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

/** An on/off switch: its track shows when off, Dashi green when on. */
export function Switch({ on, testID, onChange, disabled }: { on: boolean; testID: string; onChange?: (on: boolean) => void; disabled?: boolean }) {
  return <ControlSwitch on={on} testID={testID} {...(onChange ? { onChange } : {})} {...(disabled ? { disabled } : {})} />;
}

/** The settings file couldn't be written just now (view.tsx provides it; the page says so at its top). */
export const SaveError = createContext(false);

/**
 * Where the title's line sits in its 56 row: on the window lights' centre,
 * so the lights, the sidebar's search and the title share one line (one
 * chrome row); without lights, the row's middle.
 */
export function titleLine(controls: Bounds | null): number {
  if (!controls) return PAGE.title / 2;
  return Math.min(Math.round(controls.y + controls.height / 2), PAGE.title / 2);
}

/** The title row: the pane's name, 18 SemiBold, and an optional "· detail"; where the window is grabbed on this side. */
function TitleRow({ title, detail }: { title: string; detail?: string | undefined }) {
  const colors = useControlColors();
  const { controls } = useWindowChrome();
  const line = titleLine(controls);
  return (
    <View
      testID="settings-title"
      dragRegion
      style={{
        height: PAGE.title,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingLeft: PAGE.margin,
        paddingRight: PAGE.margin,
        // Centred on `line`: the row's middle moved up by what is left below it.
        paddingBottom: PAGE.title - 2 * line,
      }}
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
          {/* Never shorter than its content: the scroll range is this column's height, and in a narrow window
              mirin's layout guesses a row of wrapped pills shorter than it is, so a shrinking column lost its last lines. */}
          <View
            testID={`${testID}:content`}
            style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH, alignSelf: "center", flexShrink: 0, flexDirection: "column", gap: PAGE_GAP }}
          >
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
