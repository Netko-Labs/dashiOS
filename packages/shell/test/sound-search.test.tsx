/**
 * Settings' search finds each app playing sound by its name, at its own row
 * in Sound's Apps card; and an app no desktop entry names gets the icon its
 * stream names (`application.icon_name`) from the icon theme.
 */

import { describe, expect, test } from "bun:test";
import { type NativeTransport, render, View } from "@mirinjs/metal";
import { appRows, appSpot, findSettings } from "../src/settings-app/find.ts";
import { AppsCard } from "../src/settings-app/panes/sound-apps.tsx";
import { RowFocus, SpotContext } from "../src/settings-app/spot.tsx";
import { LIGHT_CONTROLS } from "../src/shared/controls/palette.ts";
import { catalogFrom } from "../src/shared/processes/index.ts";
import { AppMixer, fixedGraph, heldControl, isIconName, parseGraph, type Stream, streamApp, streamOwners, useAppNames } from "../src/sound/apps/index.ts";
import { client, link, node, vmGraph } from "./fixtures/pw-graph.ts";

const settle = (ms = 20): Promise<void> => new Promise((done) => setTimeout(done, ms));

const HELIUM = { id: "helium", name: "Helium", icon: "/icons/helium.png", exec: ["/opt/helium/helium", "%U"] };
const catalog = catalogFrom([HELIUM], []);

describe("Settings' search finds the apps playing sound", () => {
  const apps = appRows([
    { key: "helium", name: "Helium" },
    { key: "sound:paplay", name: "paplay" },
    { key: "org.gnome.Lollypop", name: "Lollypop" },
  ]);

  test("by name, at its row in Sound › Apps", () => {
    expect(findSettings("Helium", undefined, apps)[0]).toEqual({
      id: "sound/apps/helium",
      pane: "sound",
      row: "apps/helium",
      label: "Helium",
      glyph: expect.any(String),
      where: "Sound",
    });
    expect(findSettings("hel", undefined, apps)[0]?.label).toBe("Helium");
    expect(findSettings("lolly", undefined, apps).map((found) => found.id)).toEqual(["sound/apps/org.gnome.Lollypop"]);
    expect(findSettings("paplay volume", undefined, apps)[0]?.id).toBe("sound/apps/sound:paplay");
  });

  test("an app that isn't playing isn't found; neither is a word not in its name", () => {
    expect(findSettings("Helium").some((found) => found.pane === "sound")).toBe(false);
    expect(findSettings("lium", undefined, apps)).toEqual([]);
  });

  test("hidden with its pane", () => {
    expect(findSettings("Helium", (pane) => pane.id !== "sound", apps)).toEqual([]);
  });

  test("the other settings still come first when the words are theirs", () => {
    const found = findSettings("output volume", undefined, apps);
    expect(found[0]?.id).toBe("sound/output-volume");
  });
});

describe("the app's row has its own Spot", () => {
  test("search's result opens it lit", async () => {
    let last = "";
    const transport: NativeTransport = { send: (tree) => void (last = tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
    const mixer = new AppMixer({
      graph: fixedGraph(parseGraph(vmGraph())),
      control: heldControl(),
      owner: (stream) => streamApp(stream, { catalog, read: () => null }),
    });
    mixer.start();
    await settle(5);
    const focus = new RowFocus();
    const root = render(
      <SpotContext.Provider value={{ focus }}>
        <View>
          <AppsCard mixer={mixer} />
        </View>
      </SpotContext.Provider>,
      transport,
    );
    await settle();
    const key = mixer.getSnapshot().apps.find((app) => app.name === "Helium")?.key ?? "";
    expect(key).not.toBe("");
    expect(root.nodeId(`spot:apps/${key}`)).toBeDefined();
    const found = findSettings("Helium", undefined, appRows(mixer.getSnapshot().apps))[0];
    expect(found?.row).toBe(`apps/${key}`);
    expect(last).not.toContain(LIGHT_CONTROLS.lit);
    focus.request(found?.pane ?? "", found?.row ?? "");
    await settle();
    expect(last).toContain(LIGHT_CONTROLS.lit);
    expect(appSpot(key)).toBe(`sound/apps/${key}`);
    root.unmount();
    mixer.stop();
  });

  test("the names change only when an app comes or goes, not as a level moves", async () => {
    const mixer = new AppMixer({
      graph: fixedGraph(parseGraph(vmGraph())),
      control: heldControl(),
      owner: (stream) => streamApp(stream, { catalog, read: () => null }),
    });
    mixer.start();
    await settle(5);
    const seen: (readonly unknown[])[] = [];
    function Probe() {
      seen.push(useAppNames(mixer));
      return null;
    }
    const transport: NativeTransport = { send() {}, onEvent() {}, onClose() {}, simulate() {}, close() {} };
    const root = render(<Probe />, transport);
    await settle();
    const before = seen.length;
    const key = mixer.getSnapshot().apps[0]?.key ?? "";
    await mixer.setLevel(key, 0.2);
    await settle();
    expect(seen.length).toBe(before);
    expect(seen.at(-1)).toContainEqual({ key, name: expect.any(String) });
    root.unmount();
    mixer.stop();
  });
});

describe("an app's icon by its stream's application.icon_name", () => {
  const stream = (props: Record<string, unknown>): Stream => {
    const graph = parseGraph([
      client(70, { "application.process.id": 4321, "pipewire.sec.pid": 4321, ...props }),
      node(71, { "media.class": "Stream/Output/Audio", "client.id": 70, "media.name": "song" }),
      node(51, { "media.class": "Audio/Sink", "node.name": "speakers", "node.description": "Speakers" }),
      link(100, 71, 51),
    ]);
    const found = graph.streams[0];
    if (!found) throw new Error("no stream");
    return found;
  };
  const looked: string[] = [];
  const icon = (name: string) => {
    looked.push(name);
    return name === "audacious" ? "/usr/share/icons/hicolor/scalable/apps/audacious.svg" : null;
  };

  test("an app no entry names: the theme's icon", () => {
    const app = streamApp(stream({ "application.name": "Audacious", "application.icon_name": "audacious" }), { catalog, read: () => null, icon });
    expect(app).toEqual({ key: "sound:Audacious", name: "Audacious", icon: "/usr/share/icons/hicolor/scalable/apps/audacious.svg" });
  });

  test("the theme has none: the generic icon", () => {
    const app = streamApp(stream({ "application.name": "Odd", "application.icon_name": "odd-player" }), { catalog, read: () => null, icon });
    expect(app.icon).toBe(catalog.genericIcon);
  });

  test("an entry's icon wins, and the theme isn't asked", () => {
    looked.length = 0;
    const processes = new Map([[4321, { comm: "helium", ppid: 1, argv: ["/opt/helium/helium"], cgroup: "" }]]);
    const app = streamApp(stream({ "application.name": "Helium", "application.icon_name": "audacious" }), {
      catalog,
      read: (pid) => processes.get(pid) ?? null,
      icon,
    });
    expect(app.icon).toBe("/icons/helium.png");
    expect(looked).toEqual([]);
  });

  test("a name that is a path is never looked up", () => {
    looked.length = 0;
    for (const name of ["../../etc/passwd", "/usr/share/pixmaps/x", "a/b", "..", ""]) expect(isIconName(name)).toBe(false);
    for (const name of ["audacious", "org.gnome.Rhythmbox", "multimedia-audio-player", "firefox_beta"]) expect(isIconName(name)).toBe(true);
    const app = streamApp(stream({ "application.name": "Sneaky", "application.icon_name": "../../secret" }), { catalog, read: () => null, icon });
    expect(app.icon).toBe(catalog.genericIcon);
    expect(looked).toEqual([]);
  });

  test("the store's owners pass the lookup on, once per client", () => {
    looked.length = 0;
    const owner = streamOwners({ catalog: () => catalog, read: () => null, icon });
    const audacious = stream({ "application.name": "Audacious", "application.icon_name": "audacious" });
    expect(owner(audacious)?.icon).toBe("/usr/share/icons/hicolor/scalable/apps/audacious.svg");
    owner(audacious);
    expect(looked).toEqual(["audacious"]);
  });
});
