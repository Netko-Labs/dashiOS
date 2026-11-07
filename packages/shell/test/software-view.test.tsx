import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeys, readInstalled, sha256, sign, trustedComment, writeTar } from "@dashi/applet";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { AppletStore } from "../apps/software/applets/store.ts";
import { type Services, ServicesContext } from "../apps/software/services.ts";
import { SoftwareStore } from "../apps/software/store.ts";
import { SoftwareWindow } from "../apps/software/view.tsx";
import { Catalog } from "../src/applet-store/catalog.ts";
import { StoreImages } from "../src/applet-store/images.ts";
import { AppletInstaller } from "../src/applet-store/installer.ts";
import { ImageCache, JsonCache } from "../src/software/cache.ts";
import { Flathub } from "../src/software/flathub.ts";
import { Images } from "../src/software/images.ts";
import { Software } from "../src/software/manager.ts";
import type { Runner } from "../src/software/run.ts";

// Software's window on a stand-in for the Metal host: Flathub from fixtures, flatpak and pkcon faked
// (nothing is installed anywhere), and the applets from a test catalog signed with throwaway keys.

let runtime: string | undefined;
beforeAll(() => {
  // No menus socket here: the kit's menus client stays quiet (the window registers its menus).
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = mkdtempSync(join(tmpdir(), "dashi-software-runtime-"));
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
});

const settle = (ms = 40): Promise<void> => new Promise((done) => setTimeout(done, ms));

const WIDE = "com.example.Wide";

/** Flathub's answers for one app that reaches far (all files, closed source), and nothing else. */
const flathubFetch = async (url: string): Promise<Response> => {
  const path = new URL(url).pathname;
  const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  if (path.startsWith("/api/v2/collection/")) {
    return json({ hits: [{ app_id: WIDE, name: "Wide", summary: "Opens everything", developer_name: "Alex Kim" }], page: 1, totalPages: 1, totalHits: 1 });
  }
  if (path === `/api/v2/appstream/${WIDE}`) {
    return json({
      id: WIDE,
      name: "Wide",
      summary: "Opens everything",
      developer_name: "Alex Kim",
      project_license: "LicenseRef-proprietary",
      urls: { homepage: "https://example.com/wide" },
      releases: [
        { version: "2.0", timestamp: "1762300000", description: "<p>Faster opening.</p><ul><li>Dark Mode</li></ul>" },
        { version: "1.0", timestamp: "1700000000" },
      ],
    });
  }
  if (path === `/api/v2/summary/${WIDE}`) {
    return json({
      download_size: 12_000_000,
      installed_size: 40_000_000,
      metadata: { permissions: { filesystems: ["host"], shared: ["network", "ipc"], sockets: ["wayland", "pulseaudio"], devices: ["dri"] } },
    });
  }
  if (path === `/api/v2/stats/${WIDE}`) return json({ installs_last_month: 120_000 });
  return new Response("not here", { status: 404 });
};

/** flatpak and pkcon, faked: nothing installed, no updates, and an install that finishes at once. */
function fakeTools(log: string[]): Software {
  const run: Runner = async (command) => {
    log.push(command.join(" "));
    if (command[0] === "pkcon") return { code: 0, output: "Results:\n" };
    return { code: 0, output: "" };
  };
  return new Software({ run, which: (program) => `/fake/${program}`, launch: () => {} });
}

function testCatalog() {
  const dashi = generateKeys();
  const author = generateKeys();
  const dir = mkdtempSync(join(tmpdir(), "dashi-software-applets-"));
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
            notes: "Lights follow the power mode.",
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

function harness(options: { key?: boolean } = {}) {
  const tree = testCatalog();
  const root = mkdtempSync(join(tmpdir(), "dashi-software-root-"));
  const log: string[] = [];
  const store = new SoftwareStore(fakeTools(log));
  const catalog = new Catalog({ url: tree.url, key: options.key === false ? null : tree.key, cacheDir: join(tree.dir, "cache") });
  const installer = new AppletInstaller({
    root,
    dataRoot: join(tree.dir, "data"),
    dashiVersion: "0.4.0",
    download: (url, size) => catalog.download(url, size),
  });
  const g14 = { vendor: "ASUSTeK COMPUTER INC.", product: "ROG Zephyrus G14", laptop: true };
  const opened: string[] = [];
  const services: Services = {
    catalog: new Flathub({ cache: new JsonCache(join(tree.dir, "flathub")), fetch: flathubFetch }),
    images: new Images(new ImageCache(join(tree.dir, "images")), async () => new Response("", { status: 404 })),
    store,
    applets: new AppletStore(catalog, installer, async () => g14, "0.4.0", store),
    appletImages: new StoreImages(join(tree.dir, "applet-images")),
    restart: () => {},
    openUrl: (url) => opened.push(url),
  };
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const view: NativeRoot = render(
    <ServicesContext.Provider value={services}>
      <SoftwareWindow />
    </ServicesContext.Provider>,
    transport,
  );
  const press = async (testID: string): Promise<void> => {
    const nodeId = view.nodeId(testID);
    if (!nodeId) throw new Error(`no node ${testID}`);
    for (const listener of listeners) listener({ type: "press", nodeId });
    await settle();
  };
  return { view, press, store, root, log, opened, services };
}

test("an app's page leads with the trust card, and an app that reaches far asks before it installs", async () => {
  const { view, press, store, log, opened } = harness();
  await settle(120);
  await press(`card:${WIDE}`);
  await settle(80);
  const page = view.lastTree() ?? "";
  // Who made it, what it reaches, what changed, how many use it.
  expect(view.nodeId("trust-card")).toBeDefined();
  expect(page).toContain("Not verified by Flathub");
  expect(page).toContain("Read and change all your files");
  expect(page).toContain("Use the network");
  expect(page).toContain("Faster opening.");
  expect(page).toContain("Version 2.0");
  expect(page).toContain("120K installs last month");
  expect(view.nodeId("chip:proprietary")).toBeDefined();
  expect(page).toContain("Get…");

  // The website opens in the browser.
  await press("link:Website");
  expect(opened).toEqual(["https://example.com/wide"]);

  // Get… asks first; nothing is installed until the sheet says yes.
  await press("install");
  await settle(40);
  expect(view.nodeId("get-sheet")).toBeDefined();
  expect(view.lastTree()).toContain("Its code isn’t open");
  expect(log.some((line) => line.startsWith("flatpak install"))).toBe(false);
  await press("get-sheet:get");
  await settle(60);
  expect(view.nodeId("get-sheet")).toBeUndefined();
  expect(log.some((line) => line === `flatpak install --user -y flathub ${WIDE}`)).toBe(true);
  expect(store.getSnapshot().failure).toBeNull();
  view.unmount();
});

test("applets are a section of Software: one search, the trust card, and the consent sheet on a Sheet", async () => {
  const { view, press, root } = harness();
  await settle(150);
  expect(view.nodeId("nav:applets")).toBeDefined();
  // Discover shows a few, this computer's first.
  expect(view.nodeId("section:applets")).toBeDefined();
  expect(view.lastTree()).toContain("Made for this computer");

  await press("applet:dev.netko.asus-control:open");
  const page = view.lastTree() ?? "";
  expect(view.nodeId("trust-card")).toBeDefined();
  expect(page).toContain("Reviewed by Dashi");
  expect(page).toContain("Signed by its author");
  expect(page).toContain("Change the power mode, battery charge limit and processor boost");
  expect(page).toContain("Lights follow the power mode.");
  expect(view.nodeId("mark:verified")).toBeUndefined();
  expect(view.nodeId("mark:reviewed")).toBeDefined();

  // Get… shows the consent sheet; nothing is installed until it says yes.
  await press("get");
  expect(view.nodeId("applet-consent")).toBeDefined();
  expect(view.lastTree()).toContain("Get “ASUS Control”?");
  expect(readInstalled(root)).toEqual([]);
  await press("consent-add");
  await settle(150);
  expect(view.nodeId("applet-consent")).toBeUndefined();
  expect(readInstalled(root)[0]?.record.consent).toEqual(["hardware.power", "notifications"]);
  // Installed, it can be managed: turned off, and on again.
  expect(view.nodeId("manage")).toBeDefined();
  await press("manage:on");
  expect(readInstalled(root)[0]?.record.disabled).toEqual({ reason: "off" });
  await press("manage:on");
  expect(readInstalled(root)[0]?.record.disabled).toBeUndefined();
  view.unmount();
});

test("without a catalog key the applets' place isn't in the sidebar", async () => {
  const { view } = harness({ key: false });
  await settle(120);
  expect(view.nodeId("nav:discover")).toBeDefined();
  expect(view.nodeId("nav:applets")).toBeUndefined();
  expect(view.nodeId("section:applets")).toBeUndefined();
  view.unmount();
});
