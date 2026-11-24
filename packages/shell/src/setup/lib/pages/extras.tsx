import { Caption, CHECKBOX, Checkbox, Group, Row, SPACE, Switch, TYPE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useSyncExternalStore } from "react";
import { RECOMMENDED_APPS, type RecommendedApp } from "../../../shared/software/index.ts";
import type { SetupContext } from "../context.ts";
import type { ExtrasStore } from "../extras/store.ts";

/** Follows the Extras store, and looks at the computer once the page is up. */
export function useExtras(store: ExtrasStore) {
  useEffect(() => {
    void store.detect();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

function Installed({ testID }: { testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexShrink: 0 }}>
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>Installed</Text>
    </View>
  );
}

function AppRow({ app, ticked, onToggle }: { app: RecommendedApp; ticked: boolean; onToggle: () => void }) {
  const colors = useColors();
  return (
    <View testID={`setup-app:${app.id}`} style={{ flexDirection: "column", gap: SPACE.px, paddingHorizontal: SPACE.inset, paddingVertical: SPACE.m }}>
      <Checkbox testID={`setup-app:${app.id}:tick`} label={app.name} checked={ticked} onChange={onToggle} />
      <View style={{ paddingLeft: CHECKBOX.box + CHECKBOX.gap, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
          {app.summary}
        </Text>
      </View>
    </View>
  );
}

/**
 * The optional software, each with its switch: what Fedora can't ship by default (codecs, NVIDIA's
 * driver), Steam, and Flathub with a few apps. Nothing is installed until Install is pressed.
 */
export function ExtrasPage({ ctx }: { ctx: SetupContext }) {
  const { hardware, choices } = useExtras(ctx.extras);
  const store = ctx.extras;
  return (
    <>
      <Group testID="setup-extras">
        <Row label="Media codecs" detail="Play common video and music formats, like H.264 and AAC, with hardware video decoding.">
          <Switch testID="setup-extras-codecs" on={choices.codecs} onChange={(on) => store.choose({ codecs: on })} />
        </Row>
        {hardware?.nvidia && (
          <Row label="NVIDIA driver" detail="NVIDIA's own driver, for full speed in games and apps. It takes effect after a restart.">
            {hardware.nvidiaInstalled ? (
              <Installed testID="setup-extras-nvidia-installed" />
            ) : (
              <Switch testID="setup-extras-nvidia" on={choices.nvidia} onChange={(on) => store.choose({ nvidia: on })} />
            )}
          </Row>
        )}
        <Row label="Gaming" detail="Installs Steam, with GameMode, gamescope, and MangoHud. About 400 MB to download.">
          {hardware?.gamingInstalled ? (
            <Installed testID="setup-extras-gaming-installed" />
          ) : (
            <Switch testID="setup-extras-gaming" on={choices.gaming} onChange={(on) => store.choose({ gaming: on })} />
          )}
        </Row>
        <Row label="Flathub and recommended apps" detail="Flathub is where most apps for Linux are published.">
          <Switch testID="setup-extras-flathub" on={choices.flathub} onChange={(on) => store.choose({ flathub: on })} />
        </Row>
      </Group>
      {choices.flathub && (
        <>
          <Caption above>Recommended apps</Caption>
          <Group testID="setup-extras-apps">
            {RECOMMENDED_APPS.map((app) => (
              <AppRow key={app.id} app={app} ticked={choices.apps.has(app.id)} onToggle={() => store.toggleApp(app.id)} />
            ))}
          </Group>
        </>
      )}
      <Caption>Codecs and drivers come from RPM Fusion and Cisco's OpenH264. Installing them asks for your password.</Caption>
    </>
  );
}
