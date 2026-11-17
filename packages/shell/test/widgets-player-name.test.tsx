/**
 * The Music card names its player as a person knows it (pass 49 saw
 * "chromium.instance362824" on a paused card, running off its edge): the
 * desktop entry's Name, else MPRIS Identity, else the bus name cleaned; on
 * one line, cut with an ellipsis.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inkTokens } from "@dashi/ui";
import { type NativeTransport, render } from "@mirinjs/metal";
import { Card, Meta } from "../src/widgets/index.ts";
import { readPlaying } from "../src/widgets/lib/sources/media.ts";
import { busWord, desktopName, playerName } from "../src/widgets/lib/sources/player-name.ts";
import { settle } from "./support/time.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-player-name-"));
  mkdirSync(join(dir, "applications"));
  writeFileSync(join(dir, "applications", "helium.desktop"), "[Desktop Entry]\nName=Helium\nName[es]=Helio\nExec=helium %U\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a player's name", () => {
  test("the desktop entry's Name first, then Identity, then the bus name without its instance", () => {
    const entry = (id: string) => desktopName(id, [dir]);
    expect(playerName({ bus: "org.mpris.MediaPlayer2.chromium.instance362824", identity: "Chromium", desktopEntry: "helium" }, entry)).toBe("Helium");
    expect(playerName({ bus: "org.mpris.MediaPlayer2.chromium.instance362824", identity: "Chromium", desktopEntry: "missing" }, entry)).toBe("Chromium");
    expect(playerName({ bus: "org.mpris.MediaPlayer2.chromium.instance362824", identity: "", desktopEntry: "" }, entry)).toBe("Chromium");
    expect(busWord("org.mpris.MediaPlayer2.spotify")).toBe("Spotify");
  });

  test("an entry id with a slash is never read", () => {
    expect(desktopName("../../etc/passwd", [dir])).toBeNull();
  });

  test("a track read from a player carries the name, never the bus name", () => {
    const properties = new Map<string, unknown>([
      ["Metadata", new Map([["xesam:title", "Slow Tide"]])],
      ["PlaybackStatus", "Paused"],
    ]);
    expect(readPlaying("org.mpris.MediaPlayer2.chromium.instance362824", properties, 0, null)?.name).toBe("Chromium");
    expect(readPlaying("org.mpris.MediaPlayer2.chromium.instance362824", properties, 0, null, "Helium")?.name).toBe("Helium");
  });

  test("the header's small line is one line, cut with an ellipsis", async () => {
    const trees: string[] = [];
    const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
    const look = { inks: inkTokens("light"), ink: null, air: false, houseDown: false, redact: false };
    const root = render(
      <Card look={look} width={360} height={172}>
        <Meta max={16}>A player with a very long name indeed</Meta>
      </Card>,
      transport,
    );
    await settle();
    root.unmount();
    const tree = trees.at(-1) ?? "";
    expect(tree).toContain('"A player with…"');
    expect(tree).toContain('"truncate":true');
  });
});
