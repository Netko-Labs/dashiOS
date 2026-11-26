import { Button, KOMBU_SEED, LOGO, SPACE, TYPE, useColors, useTitleFace } from "@dashi/ui";
import { Svg, Text, useWindowChrome, View } from "@mirinjs/metal";
import { useMemo } from "react";
import { PAGE_INFO } from "../../flow.ts";
import { SETUP_PAGE } from "../frame.tsx";
import { startInstaller, systemLiveInstaller } from "../live.ts";

/** The first page: Dashi's bowl, its name, and what is coming. Laid out by hand, so the frame draws no heading for it. */
export function WelcomePage() {
  const colors = useColors();
  const info = PAGE_INFO.welcome;
  const titleFace = useTitleFace();
  const { controls } = useWindowChrome();
  // Booted from the live ISO: the installer is one click away.
  const installer = useMemo(systemLiveInstaller, []);
  return (
    <View
      style={{
        flex: 1,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: SPACE.gap,
        paddingTop: controls ? 0 : SETUP_PAGE.welcomeTop,
      }}
    >
      {/* The mark is Kombu's own constant, never the person's accent (CO-2). */}
      <Svg markup={LOGO} size={96} color={KOMBU_SEED} />
      <View testID="setup-title">
        <Text style={{ fontSize: TYPE.title.size, ...titleFace, color: colors.text, textAlign: "center" }}>{info.title}</Text>
      </View>
      <View testID="setup-subtitle" style={{ maxWidth: 420 }}>
        <Text style={{ fontSize: TYPE.body.size, color: colors.textMuted, textAlign: "center" }}>{info.subtitle}</Text>
      </View>
      {installer && (
        <View style={{ flexDirection: "column", alignItems: "center", gap: SPACE.s, paddingTop: SPACE.m }}>
          <Button testID="setup-install" label="Install Dashi…" onPress={() => startInstaller(installer)} />
          <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted, textAlign: "center" }}>
            You are trying Dashi from a USB drive. Install it to keep it.
          </Text>
        </View>
      )}
    </View>
  );
}
