/**
 * Who each stream belongs to, for the store (identity.ts says how), kept per
 * client so /proc is read once for each. Dashi's own streams (its event
 * sounds, Settings' level meter, the screen recorder's) belong to Dashi and
 * are not rows. The windows the compositor knows name what the installed
 * apps don't: they are read again when a stream from a new process comes,
 * and the rows are made again when they change who something is.
 */

import { type AppCatalog, type AppIdentity, DASHI_KEY } from "../../process-apps/index.ts";
import { type IdentityDeps, streamApp, streamPid } from "./identity.ts";
import type { Owner } from "./rows.ts";
import type { Stream } from "./streams.ts";

export interface OwnerOptions {
  /** The installed apps, read when first needed. */
  catalog: () => AppCatalog;
  read: IdentityDeps["read"];
  /** Each window's process and its app, as the Dock names it. */
  windows?: () => Promise<ReadonlyMap<number, AppIdentity>>;
  /** Who something is changed: make the rows again. */
  onChange?: () => void;
}

const clientKey = (stream: Stream): string => `${stream.portalAppId ?? ""}|${streamPid(stream) ?? ""}|${stream.appName ?? ""}`;

export function streamOwners(options: OwnerOptions): Owner {
  const known = new Map<string, AppIdentity | null>();
  const pids = new Set<number>();
  let windows: ReadonlyMap<number, AppIdentity> = new Map();
  let catalog: AppCatalog | null = null;
  let asking = false;

  const askWindows = () => {
    if (!options.windows || asking) return;
    asking = true;
    void options
      .windows()
      .then((next) => {
        asking = false;
        const same = next.size === windows.size && [...next].every(([pid, app]) => windows.get(pid)?.key === app.key);
        if (same) return;
        windows = next;
        known.clear();
        options.onChange?.();
      })
      .catch(() => {
        asking = false;
      });
  };

  return (stream) => {
    const key = clientKey(stream);
    const cached = known.get(key);
    if (cached !== undefined) return cached;
    catalog ??= options.catalog();
    const app = streamApp(stream, { catalog, read: options.read, windowOwner: (pid) => windows.get(pid) ?? null });
    const owner = app.key === DASHI_KEY ? null : app;
    known.set(key, owner);
    const pid = streamPid(stream);
    if (pid !== null && !pids.has(pid)) {
      pids.add(pid);
      askWindows();
    }
    return owner;
  };
}
