/**
 * What every page of the assistant sits in: the strip the window controls
 * live in (a unified title bar, as System Settings has), a centered heading,
 * the page, and the row of buttons with the progress dots.
 */

import { useColors } from "@dashi/ui";
import { ScrollView, Text, useWindowChrome, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { Button, Tile, useSurface } from "../settings-app/ui.tsx";
import type { FlowView, PageInfo } from "./flow.ts";

export interface FrameProps {
  info: PageInfo;
  view: FlowView;
  /** The glyph and color of the heading's tile; the welcome page draws its own mark. */
  glyph?: string;
  tint?: string;
  children: ReactNode;
  /** The primary button's label. */
  continueLabel?: string;
  onContinue: () => void;
  onBack: () => void;
  onSkip: () => void;
  /** Hide the heading's tile and subtitle (the welcome page lays itself out). */
  bare?: boolean;
}

function Dots({ index, count }: { index: number; count: number }) {
  const colors = useColors();
  return (
    <View testID="setup-dots" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {Array.from({ length: count }, (_, at) => (
        <View key={at} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: at === index ? colors.selection : colors.track }} />
      ))}
    </View>
  );
}

export function Frame({ info, view, glyph, tint, children, continueLabel, onContinue, onBack, onSkip, bare }: FrameProps) {
  const colors = useColors();
  const surface = useSurface();
  const { controls } = useWindowChrome();
  return (
    <View style={{ flex: 1, flexDirection: "column", backgroundColor: surface.window }}>
      {controls && <View testID="setup-toolbar" dragRegion style={{ height: Math.ceil(controls.y + controls.height), flexShrink: 0 }} />}
      {!bare && (
        <View style={{ flexShrink: 0, flexDirection: "column", alignItems: "center", gap: 6, paddingTop: controls ? 4 : 22, paddingHorizontal: 56 }}>
          {glyph && tint && <Tile glyph={glyph} tint={tint} size={44} />}
          <View testID="setup-title">
            <Text style={{ fontSize: 22, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{info.title}</Text>
          </View>
          <View testID="setup-subtitle">
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>{info.subtitle}</Text>
          </View>
        </View>
      )}
      <ScrollView
        testID={`setup-page:${info.id}`}
        style={{ flex: 1, flexDirection: "column", gap: 14, paddingHorizontal: 56, paddingTop: 18, paddingBottom: 12 }}
      >
        {children}
      </ScrollView>
      <View
        style={{
          flexShrink: 0,
          height: 64,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 28,
          borderTopWidth: 1,
          borderColor: colors.separator,
        }}
      >
        <View style={{ width: 210, flexDirection: "row", alignItems: "center" }}>
          {!view.last && <Button testID="setup-skip" label="Skip Setup" onPress={onSkip} />}
        </View>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Dots index={view.index} count={view.count} />
        </View>
        <View style={{ width: 210, flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          {!view.first && <Button testID="setup-back" label="Back" onPress={onBack} />}
          <Button testID="setup-continue" label={continueLabel ?? "Continue"} primary onPress={onContinue} />
        </View>
      </View>
    </View>
  );
}
