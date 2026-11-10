/**
 * The page a tile opens (panel.tsx): Wi-Fi, Bluetooth, Sound, the laptop's
 * power mode, keyboard light and graphics, and an applet's choice control
 * (its choices, the one chosen green). Each grows out of its tile
 * (page-parts.tsx).
 */

import { BluetoothPage } from "../../bluetooth/page.tsx";
import { SoundPage } from "../../sound/page.tsx";
import { WifiPage } from "../../wifi/page.tsx";
import type { ControlPage } from "../catalog.ts";
import type { Controls } from "../controls.tsx";
import { PageBody, PageHeader, PageNote, PageRow } from "../page-parts.tsx";
import type { ControlCenterProps } from "../panel.tsx";
import { LaptopPageView } from "./laptop-pages.tsx";

function AppletChoicePage({ id, props, controls, onBack }: { id: string; props: ControlCenterProps; controls: Controls; onBack: () => void }) {
  const tile = controls.applet(id);
  if (!tile) return <PageHeader testID="applet-page-header" title="Not available" on={false} onBack={onBack} />;
  return (
    <>
      <PageHeader testID="applet-page-header" title={tile.title} detail={tile.choice ?? tile.detail} on={tile.on} onBack={onBack} />
      <PageBody>
        {tile.choices.map((choice) => (
          <PageRow
            key={choice}
            testID={`applet-choice:${choice}`}
            label={choice}
            checked={tile.choice === choice}
            onPress={() => props.applets?.act(tile.key, { kind: "choose", choice })}
          />
        ))}
        {!tile.running && <PageNote>{`${tile.appletName} isn't running; choosing starts it.`}</PageNote>}
        <PageRow testID="applet-open" label={`${tile.appletName}…`} onPress={() => props.applets?.act(tile.key, { kind: "open" })} />
      </PageBody>
    </>
  );
}

export function PageView({ page, props, controls, onBack }: { page: ControlPage; props: ControlCenterProps; controls: Controls; onBack: () => void }) {
  const { devices, laptop } = props;
  const snapshot = controls.snapshot;
  if (page.startsWith("applet:")) return <AppletChoicePage id={page} props={props} controls={controls} onBack={onBack} />;
  switch (page) {
    case "wifi":
      return (
        <WifiPage
          wifi={props.wifi}
          radio={snapshot.wifi}
          onRadio={(on) => void devices.setWifi(on)}
          onChoose={props.onJoin}
          onBack={onBack}
          {...(props.onSettings ? { onSettings: () => props.onSettings?.("network") } : {})}
        />
      );
    case "sound":
      return (
        <SoundPage
          sound={props.sound}
          volume={snapshot.volume}
          onVolume={(level) => devices.setVolumeLevel(level)}
          onBack={onBack}
          {...(props.mixer ? { mixer: props.mixer } : {})}
          {...(props.onSettings ? { onSettings: () => props.onSettings?.("sound") } : {})}
        />
      );
    case "bluetooth":
      return <BluetoothPage bluetooth={props.bluetooth} radio={snapshot.bluetooth} onRadio={(on) => void devices.setBluetooth(on)} onBack={onBack} />;
    case "laptop-mode":
    case "laptop-light":
    case "graphics":
      return laptop ? (
        <LaptopPageView
          page={page}
          laptop={laptop}
          onBack={onBack}
          onRestart={() => laptop.run({ kind: "restart" })}
          onLightToggle={() => controls.press("keyboard", () => {})}
        />
      ) : null;
    default:
      return null;
  }
}
