/**
 * Shared set-up for the Software window tests: Flathub from fixtures, flatpak and pkcon faked,
 * a test catalog signed with throwaway keys, and the window on a stand-in for the Metal host.
 */

import { afterAll, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeys, sha256, sign, trustedComment, writeTar } from "@dashi/applet";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { AppletStore } from "../../apps/software/applets/store.ts";
import { type Services, ServicesContext } from "../../apps/software/services.ts";
import { SoftwareStore } from "../../apps/software/store.ts";
import { SoftwareWindow } from "../../apps/software/view.tsx";
import { CatalogSet } from "../../src/shared/applet-store/catalog-set.ts";
import type { CatalogSetting } from "../../src/shared/applet-store/catalogs.ts";
import { StoreImages } from "../../src/shared/applet-store/images.ts";
import { AppletInstaller } from "../../src/shared/applet-store/installer.ts";
import { ImageCache, JsonCache } from "../../src/shared/software/cache.ts";
import { Flathub } from "../../src/shared/software/flathub.ts";
import { Images } from "../../src/shared/software/images.ts";
import { Software } from "../../src/shared/software/manager.ts";
import type { Runner } from "../../src/shared/software/run.ts";
import { settle } from "./time.ts";

/** Runs a file's tests with a runtime dir of their own, put back after. */
export function isolateRuntime(): void {
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
}

export const WIDE = "com.example.Wide";

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

/** A catalog on disk signed with throwaway keys: Dashi's (ASUS Control), or another one's applet. */
export function testCatalog(
  applet: { id: string; name: string } = { id: "dev.netko.asus-control", name: "ASUS Control" },
  extra: unknown[] = [],
): { url: string; key: string; dir: string } {
  const dashi = generateKeys();
  const author = generateKeys();
  const dir = mkdtempSync(join(tmpdir(), "dashi-software-applets-"));
  const manifest = {
    id: applet.id,
    name: applet.name,
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
      ...extra,
    ],
  };
  const indexBytes = new TextEncoder().encode(JSON.stringify(index));
  writeFileSync(join(dir, "index.json"), indexBytes);
  writeFileSync(join(dir, "index.json.minisig"), sign(indexBytes, dashi.secretKey, "t"));
  return { url: `file://${join(dir, "index.json")}`, key: dashi.publicKey, dir };
}

type HarnessOptions = { key?: boolean; initialPage?: string; extra?: unknown[]; root?: string };

type Harness = {
  view: NativeRoot;
  press: (testID: string) => Promise<void>;
  type: (testID: string, value: string) => Promise<void>;
  store: SoftwareStore;
  root: string;
  log: string[];
  opened: string[];
  services: Services;
  saved: () => CatalogSetting[];
};

export function harness(options: HarnessOptions = {}): Harness {
  const tree = testCatalog(undefined, options.extra);
  const root = options.root ?? mkdtempSync(join(tmpdir(), "dashi-software-root-"));
  const log: string[] = [];
  const store = new SoftwareStore(fakeTools(log));
  // The added catalogs, kept here instead of the settings file.
  let saved: CatalogSetting[] = [];
  const catalogs = new CatalogSet({
    dashi: { name: "Dashi", url: tree.url, key: options.key === false ? null : tree.key, builtIn: true },
    cacheDir: join(tree.dir, "cache"),
    saved: {
      read: () => saved,
      write: (list) => {
        saved = [...list];
        return null;
      },
    },
  });
  const installer = new AppletInstaller({
    root,
    dataRoot: join(tree.dir, "data"),
    dashiVersion: "0.4.0",
    dashiCatalog: tree.url,
    download: (url, size, catalog) => catalogs.download(url, size, catalog),
  });
  const g14 = { vendor: "ASUSTeK COMPUTER INC.", product: "ROG Zephyrus G14", laptop: true };
  const opened: string[] = [];
  const services: Services = {
    catalog: new Flathub({ cache: new JsonCache(join(tree.dir, "flathub")), fetch: flathubFetch }),
    images: new Images(new ImageCache(join(tree.dir, "images")), async () => new Response("", { status: 404 })),
    store,
    applets: new AppletStore(catalogs, installer, async () => g14, "0.4.0", store),
    appletImages: new StoreImages(join(tree.dir, "applet-images")),
    restart: () => {},
    openUrl: (url) => opened.push(url),
  };
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const view: NativeRoot = render(
    <ServicesContext.Provider value={services}>
      <SoftwareWindow {...(options.initialPage ? { initialPage: options.initialPage } : {})} />
    </ServicesContext.Provider>,
    transport,
  );
  const press = async (testID: string): Promise<void> => {
    const nodeId = view.nodeId(testID);
    if (!nodeId) throw new Error(`no node ${testID}`);
    for (const listener of listeners) listener({ type: "press", nodeId });
    await settle();
  };
  const type = async (testID: string, value: string): Promise<void> => {
    const nodeId = view.nodeId(testID);
    if (!nodeId) throw new Error(`no node ${testID}`);
    for (const listener of listeners) listener({ type: "change", nodeId, value });
    await settle();
  };
  return { view, press, type, store, root, log, opened, services, saved: () => saved };
}
