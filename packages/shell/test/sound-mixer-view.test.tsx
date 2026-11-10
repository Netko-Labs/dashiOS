/**
 * The mixer drawn: the menu bar's microphone pill (its words only in the
 * tip, a click opens Sound), Control Center's apps (four at most, then
 * "N more"), the mute knob, and Settings' Apps card with Play on.
 */

import { describe, expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render, View } from "@mirinjs/metal";
import { AppsCard, RecordingCard } from "../src/settings-app/lib/panes/sound-apps.tsx";
import { catalogFrom } from "../src/shared/processes/index.ts";
import { AppSections, foldApps } from "../src/sound/app-rows.tsx";
import { AppMixer, type AppSound, fixedGraph, heldControl, parseGraph, streamApp, useMicWords } from "../src/sound/apps/index.ts";
import { MicPill } from "../src/sound/mic-pill.tsx";
import { vmGraph } from "./fixtures/pw-graph.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

fakeClockEachTest();

function AppSettingsCard({ mixer }: { mixer: AppMixer }) {
  return (
    <View>
      <AppsCard mixer={mixer} />
      <RecordingCard mixer={mixer} />
    </View>
  );
}

function host() {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const press = (nodeId: string | undefined) => {
    if (nodeId === undefined) throw new Error("no node");
    for (const listener of listeners) listener({ type: "press", nodeId, bounds: { x: 900, y: 3, width: 28, height: 22 } });
  };
  return { trees, listeners, transport, press };
}

const app = (key: string, extra: Partial<AppSound> = {}): AppSound => ({
  key,
  name: key,
  icon: "/icons/generic.svg",
  streams: [1],
  level: 0.5,
  muted: false,
  playing: true,
  output: "Speakers",
  target: null,
  ...extra,
});

describe("the microphone pill", () => {
  test("nothing while nobody records", async () => {
    const { trees, transport } = host();
    const root = render(<MicPill words="" onPress={() => {}} />, transport);
    await settle();
    expect(root.nodeId("mic-indicator")).toBeUndefined();
    expect(trees.at(-1) ?? "").not.toContain("microphone");
    root.unmount();
  });

  test("the words only in the tip; a click opens Sound", async () => {
    const { listeners, transport, press } = host();
    const tips: (string | null)[] = [];
    const presses: number[] = [];
    const root = render(
      <MicPill words="Signal is using the microphone." onPress={(right) => presses.push(right)} onTip={(tip) => tips.push(tip?.text ?? null)} />,
      transport,
    );
    await settle();
    const pill = root.nodeId("mic-indicator");
    if (pill === undefined) throw new Error("no pill");
    for (const listener of listeners) listener({ type: "hover", nodeId: pill, hovered: true, bounds: { x: 900, y: 3, width: 28, height: 22 } });
    press(pill);
    await settle();
    expect(tips).toEqual(["Signal is using the microphone.", null]);
    expect(presses).toEqual([928]);
    root.unmount();
  });

  test("from the mixer: on while pw-record and Signal record from the microphone", async () => {
    const catalog = catalogFrom([], []);
    const mixer = new AppMixer({
      graph: fixedGraph(parseGraph(vmGraph())),
      control: heldControl(),
      owner: (stream) => streamApp(stream, { catalog, read: () => null }),
    });
    mixer.start();
    await settle(5);
    const seen: string[] = [];
    function Probe() {
      seen.push(useMicWords(mixer));
      return null;
    }
    const { transport } = host();
    const root = render(<Probe />, transport);
    await settle();
    expect(seen.at(-1)).toBe("pw-record and Signal are using the microphone.");
    root.unmount();
    mixer.stop();
  });
});

describe("Control Center's apps", () => {
  test("four at most: past that, three and how many more", () => {
    expect(foldApps([1, 2, 3, 4])).toEqual({ shown: [1, 2, 3, 4], more: 0 });
    expect(foldApps([1, 2, 3, 4, 5, 6])).toEqual({ shown: [1, 2, 3], more: 3 });
  });

  test("a slider and a mute knob per app; muted reads Muted; the microphone's apps read only", async () => {
    const { trees, transport, press } = host();
    const muted: Array<[string, boolean]> = [];
    const more: number[] = [];
    const recording = [{ key: "signal", name: "Signal", icon: "/icons/signal.png", input: "Microphone", monitor: false }];
    const apps = [app("Helium"), app("paplay", { muted: true }), app("A"), app("B"), app("C")];
    const root = render(
      <View>
        <AppSections apps={apps} recording={recording} onLevel={() => {}} onMute={(key, value) => muted.push([key, value])} onMore={() => more.push(1)} />
      </View>,
      transport,
    );
    await settle();
    const tree = trees.at(-1) ?? "";
    expect(root.nodeId("sound-app:Helium")).toBeDefined();
    expect(root.nodeId("sound-app:B")).toBeUndefined();
    expect(tree).toContain("Muted");
    expect(tree).toContain("50%");
    expect(tree).toContain("2 more in Sound Settings…");
    expect(tree).toContain("Using the microphone");
    expect(root.nodeId("sound-recording:signal")).toBeDefined();
    press(root.nodeId("sound-app-mute:paplay"));
    press(root.nodeId("sound-apps-more"));
    await settle();
    expect(muted).toEqual([["paplay", false]]);
    expect(more).toEqual([1]);
    root.unmount();
  });

  test("nothing playing or recording: no sections", async () => {
    const { trees, transport } = host();
    const root = render(<AppSections apps={[]} recording={[]} onLevel={() => {}} onMute={() => {}} />, transport);
    await settle();
    expect(trees.at(-1) ?? "").not.toContain("Apps");
    root.unmount();
  });
});

describe("Settings' Apps card", () => {
  test("every app with its state and Play on; none says so", async () => {
    const { trees, transport, press } = host();
    const catalog = catalogFrom([], []);
    const mixer = new AppMixer({
      graph: fixedGraph(parseGraph(vmGraph())),
      control: heldControl(),
      owner: (stream) => streamApp(stream, { catalog, read: () => null }),
    });
    mixer.start();
    await settle(5);
    const root = render(<AppSettingsCard mixer={mixer} />, transport);
    await settle();
    const tree = trees.at(-1) ?? "";
    for (const name of ["Helium", "Lollypop", "paplay", "pw-play"]) expect(tree).toContain(name);
    expect(tree).toContain("Playing");
    expect(tree).toContain("Headphones");
    expect(tree).toContain("Default");
    expect(tree).toContain("Using Microphone now");
    press(root.nodeId("sound-app-mute:sound:paplay"));
    await settle();
    expect(mixer.getSnapshot().apps.find((each) => each.key === "sound:paplay")?.muted).toBe(false);
    root.unmount();
    mixer.stop();

    const empty = host();
    const none = new AppMixer({ graph: fixedGraph({ streams: [], outputs: [], defaultOutput: null }), control: heldControl(), owner: () => null });
    none.start();
    await settle(5);
    const second = render(<AppSettingsCard mixer={none} />, empty.transport);
    await settle();
    expect(empty.trees.at(-1) ?? "").toContain("No apps are playing sound.");
    second.unmount();
    none.stop();
  });
});
