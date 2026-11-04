import { describe, expect, test } from "bun:test";
import { Variant } from "../src/dbus/variant.ts";
import type { ExtraIcon } from "../src/extras/types.ts";
import { iconSource, itemExtra, parseItemProperties } from "../src/tray/props.ts";

/** A GetAll reply as the bus hands it over: a Map of Variants. */
function reply(values: Record<string, Variant>): Map<string, Variant> {
  return new Map(Object.entries(values));
}

const pixmap = (side: number): [number, number, Uint8Array] => [side, side, new Uint8Array(side * side * 4)];

const icon: ExtraIcon = { kind: "image", path: "/icons/app.png" };

const BASE = {
  Id: new Variant("s", "nextcloud"),
  Title: new Variant("s", "Nextcloud"),
  Status: new Variant("s", "Active"),
  IconName: new Variant("s", "nextcloud"),
  ItemIsMenu: new Variant("b", false),
  Menu: new Variant("o", "/MenuBar"),
};

describe("parseItemProperties", () => {
  test("reads what an item reports", () => {
    const properties = parseItemProperties(
      reply({
        ...BASE,
        IconPixmap: new Variant("a(iiay)", [pixmap(16), pixmap(32)]),
        AttentionIconName: new Variant("s", "nextcloud-alert"),
        IconThemePath: new Variant("s", "/opt/nextcloud/icons"),
        ToolTip: new Variant("(sa(iiay)ss)", ["", [], "Nextcloud", "Synced <b>3</b> files"]),
      }),
    );
    expect(properties).toMatchObject({
      id: "nextcloud",
      title: "Nextcloud",
      status: "Active",
      iconName: "nextcloud",
      attentionIconName: "nextcloud-alert",
      iconThemePath: "/opt/nextcloud/icons",
      toolTip: { title: "Nextcloud", description: "Synced 3 files" },
      itemIsMenu: false,
      menu: "/MenuBar",
    });
    expect(properties?.iconPixmaps.map((each) => each.width)).toEqual([16, 32]);
  });

  test("reads wrong types as absent, and an unknown status as Active", () => {
    const properties = parseItemProperties(
      reply({
        Id: new Variant("i", 3),
        Status: new Variant("s", "Sleeping"),
        IconPixmap: new Variant("a(iiay)", [[2, 2, new Uint8Array(3)]]),
        Menu: new Variant("o", "/"),
        ItemIsMenu: new Variant("s", "yes"),
      }),
    );
    expect(properties).toMatchObject({ id: "", status: "Active", iconPixmaps: [], menu: null, itemIsMenu: false, toolTip: null });
  });

  test("is null for a reply that is not a dictionary", () => {
    expect(parseItemProperties("nope")).toBeNull();
    expect(parseItemProperties(new Map([[1, new Variant("s", "x")]]))).toBeNull();
  });

  test("Qt's no-menu path is no menu", () => {
    expect(parseItemProperties(reply({ ...BASE, Menu: new Variant("o", "/NO_DBUSMENU") }))?.menu).toBeNull();
  });
});

describe("itemExtra", () => {
  const parse = (values: Record<string, Variant>) => {
    const properties = parseItemProperties(reply(values));
    if (!properties) throw new Error("did not parse");
    return properties;
  };

  test("maps an item to a tray extra", () => {
    const properties = parse({ ...BASE, ToolTip: new Variant("(sa(iiay)ss)", ["", [], "Nextcloud", "Up to date"]) });
    expect(itemExtra("tray::1.4/StatusNotifierItem", properties, icon)).toEqual({
      key: "tray::1.4/StatusNotifierItem",
      source: "tray",
      title: "Nextcloud",
      icon,
      tooltip: "Nextcloud\nUp to date",
      attention: false,
      menuOnClick: false,
      hasMenu: true,
    });
  });

  test("falls back to the Id for the title, and has no tooltip without one", () => {
    const extra = itemExtra("k", parse({ ...BASE, Title: new Variant("s", "") }), null);
    expect(extra?.title).toBe("nextcloud");
    expect(extra && "tooltip" in extra).toBe(false);
  });

  test("a Passive item is not shown", () => {
    expect(itemExtra("k", parse({ ...BASE, Status: new Variant("s", "Passive") }), icon)).toBeNull();
  });

  test("NeedsAttention marks the extra and draws the attention icon", () => {
    const properties = parse({ ...BASE, Status: new Variant("s", "NeedsAttention"), AttentionIconName: new Variant("s", "mail-unread") });
    expect(itemExtra("k", properties, icon)?.attention).toBe(true);
    expect(iconSource(properties).name).toBe("mail-unread");
  });

  test("NeedsAttention without an attention icon keeps the item's own", () => {
    const properties = parse({ ...BASE, Status: new Variant("s", "NeedsAttention") });
    expect(iconSource(properties).name).toBe("nextcloud");
    expect(iconSource(parse(BASE)).name).toBe("nextcloud");
  });

  test("ItemIsMenu opens the menu on click when there is one", () => {
    expect(itemExtra("k", parse({ ...BASE, ItemIsMenu: new Variant("b", true) }), icon)).toMatchObject({ menuOnClick: true, hasMenu: true });
    const noMenu = parse({ ...BASE, ItemIsMenu: new Variant("b", true), Menu: new Variant("o", "/") });
    expect(itemExtra("k", noMenu, icon)).toMatchObject({ menuOnClick: false, hasMenu: false });
  });
});
