/**
 * Extensions in the shell (docs/betterments.html, wave 3): what other
 * programs add to the launcher and what they can reach of it.
 *
 * - Applets' commands (applets/commands.ts): a source in the action registry.
 * - Your own scripts (actions/scripts.ts): another.
 * - GNOME's search providers (search-providers/): read as the launcher's slow
 *   sources, results only, behind the registry.
 * - `dev.dashi.Shell.Actions1` (actions/dbus.ts): the registry, listed and run
 *   by address on the session bus, with a link's consent.
 *
 * main.tsx makes the applets' commands first (startApplets answers them on
 * the applets' connections) and calls this once the registry is up.
 */

import { type ActionRegistry, actionsInterface, type Outcome, ScriptSource, scriptsDir } from "../actions/index.ts";
import type { AppletCommands } from "../applets/commands.ts";
import type { Entry } from "../entries.ts";
import { ExtensionSession } from "../launcher/extensions.ts";
import type { PortalHost } from "../portal-host/service.ts";
import { SearchProviders } from "../search-providers/index.ts";
import { SHELL_PATH } from "../shared/portal-host/protocol.ts";

export interface ExtensionsOptions {
  registry: ActionRegistry;
  appletCommands: AppletCommands;
  /** A `dashi://` link from outside (actions/start.ts `openLink`): what D-Bus callers run. */
  openLink(url: string): Promise<Outcome>;
  /** Open what a command answered with: a web page or a `dashi://` address. */
  open(target: string): Promise<Outcome>;
  copy(text: string): Promise<boolean>;
  /** The installed apps: a provider is asked only while its app is installed. */
  entries(): readonly Entry[];
  /** The shell's session-bus name, once it has it. */
  bus: Promise<PortalHost | null>;
}

export interface Extensions {
  /** What the launcher keeps for the session (launcher/extensions.ts). */
  readonly session: ExtensionSession;
  close(): void;
}

/** What a command's `open` answer reaches: a web page through the person's browser (gio), a `dashi://` link through the registry. */
export function openTarget(target: string, deps: { openUrl(url: string): void; openLink(url: string): Promise<Outcome> }): Promise<Outcome> {
  if (/^dashi:\/\//i.test(target)) return deps.openLink(target);
  if (!/^https?:\/\/\S+$/.test(target)) return Promise.resolve({ ok: false, error: "That can't be opened." });
  deps.openUrl(target);
  return Promise.resolve({ ok: true, text: `Opened ${target}` });
}

export function startExtensions(options: ExtensionsOptions): Extensions {
  const { registry } = options;
  const stopApplets = registry.add(options.appletCommands);
  const scripts = new ScriptSource({ dir: scriptsDir(), copy: options.copy, open: options.open, ...(process.getuid ? { uid: process.getuid() } : {}) }).start();
  const stopScripts = registry.add(scripts);
  const providers = new SearchProviders();
  const session = new ExtensionSession(() => providers.sources(options.entries()));
  void options.bus.then((host) => host?.serve(SHELL_PATH, [actionsInterface({ registry, open: options.openLink })]));
  return {
    session,
    close() {
      stopApplets();
      stopScripts();
      scripts.close();
      providers.close();
    },
  };
}
