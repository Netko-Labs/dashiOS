/**
 * The kill switch without the store open: a few minutes after login and
 * then once a day, the shell fetches the catalog's index (checked with
 * Dashi's key, as the store does) and turns off every installed version it
 * lists as pulled. The launcher sees the change in the applets folder and
 * stops it. Nothing is installed or updated here; that is the person's, in
 * the Applet Store.
 */

import { appletDataRoot, appletsRoot, SDK_VERSION } from "@dashi/applet";
import { Catalog, DEFAULT_INDEX, keyFrom, storeCacheDir } from "./catalog.ts";
import { AppletInstaller } from "./installer.ts";
import { DASHI_INDEX_KEY } from "./keys.ts";

const FIRST_MS = 3 * 60_000;
const EVERY_MS = 24 * 60 * 60_000;

/** One look: the ids it turned off (none when there is no key, no network, or nothing pulled). */
export async function applyKillSwitch(catalog: Catalog, installer: AppletInstaller): Promise<string[]> {
  if (installer.installed().every((applet) => applet.record.source !== "catalog")) return [];
  try {
    const { index } = await catalog.load();
    return installer.disablePulled(index);
  } catch {
    return [];
  }
}

/** Starts the daily look; returns what stops it. */
export function watchKillSwitch(env: Readonly<Record<string, string | undefined>> = process.env): () => void {
  const key = keyFrom(env.DASHI_APPLETS_KEY) ?? DASHI_INDEX_KEY;
  if (!key) return () => {};
  const catalog = new Catalog({ url: env.DASHI_APPLETS_INDEX ?? DEFAULT_INDEX, key, cacheDir: storeCacheDir(env) });
  const installer = new AppletInstaller({
    root: appletsRoot(),
    dataRoot: appletDataRoot(),
    dashiVersion: SDK_VERSION,
    download: () => Promise.reject(new Error("the kill switch downloads nothing")),
  });
  const look = (): void => {
    void applyKillSwitch(catalog, installer).then((ids) => {
      if (ids.length > 0) console.error(`dashi-shell: pulled from the applet catalog, turned off: ${ids.join(", ")}`);
    });
  };
  const first = setTimeout(look, FIRST_MS);
  const daily = setInterval(look, EVERY_MS);
  first.unref?.();
  daily.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(daily);
  };
}
