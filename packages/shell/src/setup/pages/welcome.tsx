import { Button, LOGO, useColors } from "@dashi/ui";
import { Svg, Text, useWindowChrome, View } from "@mirinjs/metal";
import { useMemo } from "react";
import { PAGE_INFO } from "../flow.ts";
import { startInstaller, systemLiveInstaller } from "../live.ts";

/** The first page: Dashi's bowl, its name, and what is coming. Laid out by hand, so the frame draws no heading for it. */
export function WelcomePage() {
  const colors = useColors();
  const info = PAGE_INFO.welcome;
  const { controls } = useWindowChrome();
  // Booted from the live ISO: the installer is one click away.
  const installer = useMemo(systemLiveInstaller, []);
  return (
    <View style={{ flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, paddingTop: controls ? 0 : 40 }}>
      <Svg markup={LOGO} size={96} color={colors.selection} />
      <View testID="setup-title">
        <Text style={{ fontSize: 30, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{info.title}</Text>
      </View>
      <View testID="setup-subtitle" style={{ maxWidth: 420 }}>
        <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>{info.subtitle}</Text>
      </View>
      {installer && (
        <View style={{ flexDirection: "column", alignItems: "center", gap: 6, paddingTop: 8 }}>
          <Button testID="setup-install" label="Install Dashi…" onPress={() => startInstaller(installer)} />
          <Text style={{ fontSize: 11, color: colors.textMuted, textAlign: "center" }}>You are trying Dashi from a USB drive. Install it to keep it.</Text>
        </View>
      )}
    </View>
  );
}
