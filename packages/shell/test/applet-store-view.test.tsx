import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeys, readInstalled, sha256, sign, trustedComment, writeTar } from "@dashi/applet";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { AppletStore } from "../apps/applet-store/model.ts";
import { ServicesContext } from "../apps/applet-store/services.ts";
import { StoreWindow } from "../apps/applet-store/view.tsx";
import { Catalog } from "../src/applet-store/catalog.ts";
import { StoreImages } from "../src/applet-store/images.ts";
import { AppletInstaller } from "../src/applet-store/installer.ts";

// The Applet Store's window on a stand-in for the Metal host, over a test catalog signed with throwaway keys.

const settle = (ms = 30): Promise<void> => new Promise((done) => setTimeout(done, ms));

function testCatalog() {
  const dashi = generateKeys();
  const author = generateKeys();
  const dir = mkdtempSync(join(tmpdir(), "dashi-store-view-"));
  const manifest = {
    id: "dev.netko.asus-control",
    name: "ASUS Control",
    version: "0.1.0",
    dashi: ">=0.4",
    entry: "src/main.tsx",
    summary: "Fans, power and lights for ROG and TUF laptops.",
    author: { name: "Netko Labs" },
    categories: ["hardware"],
    when: { vendor: "ASUSTeK COMPUTER INC.", laptop: true },
    permissions: ["hardware.power", "notifications"],
  };
  const bytes = writeTar(
    new Map([
      ["applet.json", new TextEncoder().encode(JSON.stringify(manifest))],
      ["main.js", new TextEncoder().encode("1")],
    ]),
  );
  const file = join(dir, "asus.dashi-applet");
  writeFileSync(file, bytes);
  const index = {
    format: 1,
    generated: "2026-11-05T00:00:00Z",
    applets: [
      {
        manifest,
        authorKey: author.publicKey.split("\n")[1],
        reviewed: true,
        source: { url: "https://github.com/Netko-Labs/asus-control", commit: "0123456" },
        versions: [
          {
            version: "0.1.0",
            dashi: ">=0.4",
            url: `file://${file}`,
            sha256: sha256(bytes),
            size: bytes.byteLength,
            signature: sign(bytes, author.secretKey, trustedComment(manifest, sha256(bytes))),
            released: "2026-11-04",
          },
        ],
      },
    ],
  };
  const indexBytes = new TextEncoder().encode(JSON.stringify(index));
  writeFileSync(join(dir, "index.json"), indexBytes);
  writeFileSync(join(dir, "index.json.minisig"), sign(indexBytes, dashi.secretKey, "t"));
  return { url: `file://${join(dir, "index.json")}`, key: dashi.publicKey, dir };
}

test("the store lists the catalog, puts this computer's first, asks before it adds one, and installs it", async () => {
  const tree = testCatalog();
  const root = mkdtempSync(join(tmpdir(), "dashi-store-root-"));
  const catalog = new Catalog({ url: tree.url, key: tree.key, cacheDir: join(tree.dir, "cache") });
  const installer = new AppletInstaller({
    root,
    dataRoot: join(tree.dir, "data"),
    dashiVersion: "0.4.0",
    download: (url, size) => catalog.download(url, size),
  });
  const g14 = { vendor: "ASUSTeK COMPUTER INC.", product: "ROG Zephyrus G14", laptop: true };
  const store = new AppletStore(catalog, installer, async () => g14, "0.4.0");
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root_: NativeRoot = render(
    <ServicesContext.Provider value={{ store, images: new StoreImages(join(tree.dir, "images")) }}>
      <StoreWindow />
    </ServicesContext.Provider>,
    transport,
  );
  const press = async (testID: string): Promise<void> => {
    const nodeId = root_.nodeId(testID);
    if (!nodeId) throw new Error(`no node ${testID}`);
    for (const listener of listeners) listener({ type: "press", nodeId });
    await settle();
  };
  await settle(80);
  expect(root_.nodeId("for-here")).toBeDefined();
  expect(root_.nodeId("applet:dev.netko.asus-control")).toBeDefined();
  expect(root_.lastTree()).toContain("for this computer");

  // Its page: Reviewed, what it can do in plain words, and that it fits this one.
  await press("applet:dev.netko.asus-control:open");
  const page = root_.lastTree() ?? "";
  expect(page).toContain("Reviewed");
  expect(page).toContain("Change the power mode, battery charge limit and processor boost");
  expect(page).toContain("this one ✓");
  expect(page).toContain("github.com/Netko-Labs/asus-control");

  // Get asks first; nothing is installed until the sheet says yes.
  await press("get");
  expect(root_.nodeId("applet-consent")).toBeDefined();
  expect(root_.lastTree()).toContain("Add “ASUS Control”?");
  expect(readInstalled(root)).toEqual([]);
  await press("consent-add");
  await settle(80);
  expect(root_.nodeId("applet-consent")).toBeUndefined();
  expect(readInstalled(root)[0]?.record.consent).toEqual(["hardware.power", "notifications"]);
  root_.unmount();
});
