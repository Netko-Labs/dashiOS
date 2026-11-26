/**
 * What every page of the assistant sits in: the strip the window controls
 * live in (a unified title bar, as System Settings has), a centered heading,
 * the page, and the row of buttons with the progress dots.
 */

import { Button, RADIUS, SPACE, Tile, TYPE, useColors, useSurface, useTitleFace, WIZARD_PAGE } from "@dashi/ui";
import { ScrollView, Text, useWindowChrome, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { FlowView, PageInfo } from "../flow.ts";

/** The welcome page's room above the bowl without window controls; the words keep the kit's wizard inset from the sides. */
export const SETUP_PAGE = { welcomeTop: 40 } as const;

export interface FrameProps {
  info: PageInfo;
  view: FlowView;
  /** The glyph and color of the heading's tile; the welcome page draws its own mark. */
  glyph?: string;
  tint?: string;
  children: ReactNode;
  /** The primary button's label. */
  continueLabel?: string;
  /** The primary button greyed out (a page waiting on something). */
  continueDisabled?: boolean;
  /** No Back button (a page whose work can't be stepped back from). */
  hideBack?: boolean;
  onContinue: () => void;
  onBack: () => void;
  onSkip: () => void;
  /** Hide the heading's tile and subtitle (the welcome page lays itself out). */
  bare?: boolean;
  /** Over everything: the sheet that asks before Skip Setup. */
  overlay?: ReactNode;
}

function Dots({ index, count }: { index: number; count: number }) {
  const colors = useColors();
  return (
    <View testID="setup-dots" style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
      {Array.from({ length: count }, (_, at) => (
        <View key={at} style={{ width: 7, height: 7, borderRadius: RADIUS.check, backgroundColor: at === index ? colors.text : colors.track }} />
      ))}
    </View>
  );
}

export function Frame({ info, view, glyph, tint, children, continueLabel, continueDisabled, hideBack, onContinue, onBack, onSkip, bare, overlay }: FrameProps) {
  const colors = useColors();
  const surface = useSurface();
  const { controls } = useWindowChrome();
  const titleFace = useTitleFace();
  return (
    <View style={{ flex: 1, flexDirection: "column", backgroundColor: surface.window, position: "relative" }}>
      {controls && <View testID="setup-toolbar" dragRegion style={{ height: Math.ceil(controls.y + controls.height), flexShrink: 0 }} />}
      {!bare && (
        <View
          style={{
            flexShrink: 0,
            flexDirection: "column",
            alignItems: "center",
            gap: SPACE.s,
            paddingTop: controls ? SPACE.xs : SPACE.sheet,
            paddingHorizontal: WIZARD_PAGE.inset,
          }}
        >
          {glyph && tint && <Tile glyph={glyph} tint={tint} size={44} />}
          <View testID="setup-title">
            <Text style={{ fontSize: TYPE.title.size, ...titleFace, color: colors.text, textAlign: "center" }}>{info.title}</Text>
          </View>
          <View testID="setup-subtitle">
            <Text style={{ fontSize: TYPE.body.size, color: colors.textMuted, textAlign: "center" }}>{info.subtitle}</Text>
          </View>
        </View>
      )}
      <ScrollView
        testID={`setup-page:${info.id}`}
        style={{ flex: 1, flexDirection: "column", paddingHorizontal: WIZARD_PAGE.inset, paddingTop: SPACE.page, paddingBottom: SPACE.inset }}
      >
        {/* Never shorter than its content: the scroll range is this column's height (as Settings' pages, settings-app/ui.tsx). */}
        <View testID={`setup-page:${info.id}:content`} style={{ flexShrink: 0, flexDirection: "column", gap: SPACE.button }}>
          {children}
        </View>
      </ScrollView>
      <View
        style={{
          flexShrink: 0,
          height: 64,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: SPACE.xl,
          borderTopWidth: 1,
          borderColor: colors.separator,
        }}
      >
        <View style={{ width: 210, flexDirection: "row", alignItems: "center" }}>
          {!view.last && <Button testID="setup-skip" label="Skip Setup…" onPress={onSkip} />}
        </View>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Dots index={view.index} count={view.count} />
        </View>
        <View style={{ width: 210, flexDirection: "row", justifyContent: "flex-end", gap: SPACE.m }}>
          {!view.first && !hideBack && <Button testID="setup-back" label="Back" onPress={onBack} />}
          <Button testID="setup-continue" label={continueLabel ?? "Continue"} primary disabled={continueDisabled === true} onPress={onContinue} />
        </View>
      </View>
      {overlay}
    </View>
  );
}
