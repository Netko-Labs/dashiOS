import { Button, Group, Row, Shortcut, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { useFlags } from "../../control-center/flags.ts";
import { useRegion } from "../../region/store.ts";
import { useSettings } from "../../settings-app/hooks.ts";
import { describeLayout } from "../../settings-app/layouts.ts";
import { useClockPrefs, usesHour24 } from "../../shared/time/clock.ts";
import { useWifi } from "../../wifi/store.ts";
import type { SetupContext } from "../context.ts";
import { runSummary } from "../extras/words.ts";

function Value({ children, testID }: { children: string; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexShrink: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ fontSize: 13, color: colors.textMuted }}>
        {children}
      </Text>
    </View>
  );
}

/** The one thing to know on day one: a tap of ❖ finds anything. Try it opens the launcher over the assistant. */
function TapToFind({ ctx }: { ctx: SetupContext }) {
  const colors = useColors();
  return (
    <Group testID="setup-launcher">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 }}>
        {/* ❖ is drawn, not typed: text fonts don't reliably carry it (shortcut.tsx). */}
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Text style={{ fontSize: 13, color: colors.text }}>Tap</Text>
          <Shortcut keys="❖" color={colors.text} size={13} />
          <Text style={{ fontSize: 13, color: colors.text }}>to find anything</Text>
        </View>
        {ctx.openLauncher && <Button label="Try it" testID="setup-try-launcher" onPress={() => ctx.openLauncher?.()} />}
      </View>
    </Group>
  );
}

/** What was chosen, as System Settings will show it, after how to find anything from here on. */
export function DonePage({ ctx }: { ctx: SetupContext }) {
  const region = useRegion(ctx.region);
  const { keyboard, region: chosen, appearance } = useSettings(ctx.settings).data;
  const { dark } = useFlags(ctx.flags);
  const clock = useClockPrefs();
  const network = useWifi(ctx.wifi).current;
  const extras = runSummary(useSyncExternalStore(ctx.extras.subscribe, ctx.extras.getSnapshot).run);
  const language = region.locales.find((entry) => entry.id === region.language)?.label ?? region.language ?? "Not set";
  const formats = chosen.formats ? (region.locales.find((entry) => entry.id === chosen.formats)?.region ?? chosen.formats) : "Same as language";
  return (
    <>
      <TapToFind ctx={ctx} />
      <Group testID="setup-summary">
        <Row label="Language">
          <Value testID="setup-summary-language">{language}</Value>
        </Row>
        <Row label="Region formats">
          <Value testID="setup-summary-formats">{formats}</Value>
        </Row>
        <Row label="Keyboard">
          <Value testID="setup-summary-keyboard">{describeLayout(ctx.layouts.layouts, keyboard.layout)}</Value>
        </Row>
        {network && (
          <Row label="Wi-Fi">
            <Value testID="setup-summary-wifi">{network.ssid}</Value>
          </Row>
        )}
        <Row label="Time zone">
          <Value testID="setup-summary-timezone">{region.timezone.replaceAll("_", " ")}</Value>
        </Row>
        <Row label="Appearance">
          <Value testID="setup-summary-appearance">{`${appearance.auto ? "Auto" : dark ? "Dark" : "Light"}, ${usesHour24(clock) ? "24-hour" : "12-hour"} clock`}</Value>
        </Row>
        {extras && (
          <Row label="Extras">
            <Value testID="setup-summary-extras">{extras}</Value>
          </Row>
        )}
      </Group>
    </>
  );
}
