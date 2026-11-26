/**
 * Sheets and the window's sidebar on glass (design.html UI-5, GL-2, GL-3, TY-2; decisions.md D810 to
 * D816): a shell's sheet is regular glass at radius 14, a sheet inside an app's window is regular's
 * twin, a glass sheet hung over a window has its scrim round it, never under it; the sidebar is thick
 * glass while its window has focus and thick's twin without it; a title of 20 is Inter Display.
 */

import { describe, expect, test } from "bun:test";
import { Text } from "@mirinjs/metal";
import { SHEET_RADIUS, Sheet } from "../src/sheet.tsx";
import { bandsAround, cornerMarkup } from "../src/sheet-scrim.tsx";
import { Appearance } from "../src/theme/appearance.ts";
import { SCRIM } from "../src/theme/colors.ts";
import { GLASS } from "../src/theme/glass.ts";
import { WEIGHT } from "../src/theme/measures.ts";
import { titleFace } from "../src/title-face.ts";
import { AppWindow } from "../src/window.tsx";
import { settle } from "./support/time.ts";
import { sent } from "./support/tree.ts";

const SAYS_GLASS = { type: "protocol", nodeId: "root", patches: 0, glass: true } as const;
const light = (children: React.ReactNode) => <Appearance dark={false}>{children}</Appearance>;

describe("a sheet on glass", () => {
  test("a shell's sheet (on a surface of its own) is regular glass at 14, its twin until the host takes glass", async () => {
    const { node, host } = await sent(
      light(
        <Sheet testID="ask" place="screen">
          <Text>Log out now?</Text>
        </Sheet>,
      ),
    );
    expect(node("ask")?.props.material).toBeUndefined();
    expect(node("ask")?.props.background).toBe(GLASS.levels.regular.light.solid);
    expect(node("ask")?.props.cornerRadius).toBe(SHEET_RADIUS);
    host.emit(SAYS_GLASS);
    await settle();
    expect(node("ask")?.props.material).toBe("regular");
  });

  test("a sheet inside an app's own window stays regular's twin, over the whole scrim (D811)", async () => {
    const { node, host } = await sent(
      light(
        <Sheet testID="ask">
          <Text>Delete “Groceries”?</Text>
        </Sheet>,
      ),
    );
    host.emit(SAYS_GLASS);
    await settle();
    expect(node("ask")?.props.material).toBeUndefined();
    expect(node("ask")?.props.background).toBe(GLASS.levels.regular.light.solid);
    expect(node("ask:scrim")?.props.background).toBe(SCRIM.light);
    expect(node("scrim:above")).toBeNull();
  });

  test("hung over a window from a surface of its own, it is glass and the scrim goes round it (D812)", async () => {
    const { node, host } = await sent(
      light(
        <Sheet testID="pw" hang={28}>
          <Text>Change password</Text>
        </Sheet>,
      ),
    );
    host.emit(SAYS_GLASS);
    await settle();
    expect(node("pw")?.props.material).toBe("regular");
    expect(node("pw:scrim")?.props.background).toBeUndefined();
  });

  test("the scrim's bands meet the card's edges and the corner pieces fill outside its rounding", () => {
    const card = { x: 100, y: 40, width: 380, height: 160 };
    const bands = Object.fromEntries(bandsAround(card).map(({ key, style }) => [key, style]));
    expect(bands.above).toEqual({ left: 0, right: 0, top: 0, height: 40 });
    expect(bands.below).toEqual({ left: 0, right: 0, top: 200, bottom: 0 });
    expect(bands.left).toEqual({ left: 0, top: 40, width: 100, height: 160 });
    expect(bands.right).toEqual({ left: 480, right: 0, top: 40, height: 160 });
    expect(cornerMarkup("topLeft")).toContain('d="M0 0H1A1 1 0 0 0 0 1Z"');
    expect(cornerMarkup("bottomRight")).toContain("currentColor");
  });
});

describe("the window's sidebar (GL-2)", () => {
  test("thick glass while the window has focus; thick's twin without it, the content opaque", async () => {
    const { node, host } = await sent(
      light(
        <AppWindow title="Files" sidebar={<Text>Recents</Text>}>
          <Text>Documents</Text>
        </AppWindow>,
      ),
    );
    host.emit(SAYS_GLASS);
    await settle();
    expect(node("window-sidebar")?.props.material).toBe("thick");
    host.emit({ type: "active", nodeId: "root", active: false });
    await settle();
    expect(node("window-sidebar")?.props.material).toBeUndefined();
    expect(node("window-sidebar")?.props.background).toBe(GLASS.levels.thick.light.solid);
    host.emit({ type: "active", nodeId: "root", active: true });
    await settle();
    expect(node("window-sidebar")?.props.material).toBe("thick");
  });
});

describe("a title of 20 and up (TY-2)", () => {
  test("Inter Display SemiBold on a host that draws it, Inter SemiBold on one that doesn't", () => {
    expect(titleFace(true)).toEqual({ fontFamily: "display", fontWeight: WEIGHT.semibold });
    expect(titleFace(false)).toEqual({ fontWeight: WEIGHT.semibold });
  });
});
