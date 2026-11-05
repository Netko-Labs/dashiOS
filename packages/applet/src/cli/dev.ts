/**
 * `dashi-applet dev`: runs the applet in this folder from its source, as a
 * developer's (the bar marks it "dev"), shows each message between it and
 * the shell, and starts it again when a file under src/ or applet.json is
 * saved. `--vm` does the same in Dashi's development VM (vm/vm ssh; the VM
 * sees ~/Developer at /mnt/developer).
 */

import { existsSync, readFileSync, watch } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { LOG_MARK } from "../define.ts";
import { readManifest } from "../manifest.ts";
import { appletsSocketPath } from "../protocol.ts";
import { MessageLog } from "./log.ts";
import { sdkPaths } from "./templates.ts";

/** One argument for a POSIX shell, single-quoted. */
export const shellQuote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

/** Where the VM sees a path under ~/Developer; null for one outside it. */
export function vmPath(path: string, home = homedir()): string | null {
  const inside = relative(join(home, "Developer"), path);
  return inside.startsWith("..") || inside.startsWith("/") ? null : join("/mnt/developer", inside);
}

/** The command `--vm` runs in the VM's session. */
export function vmCommand(appletDir: string, sdkDir: string, home = homedir()): string | null {
  const dir = vmPath(appletDir, home);
  const sdk = vmPath(sdkDir, home);
  if (!dir || !sdk) return null;
  return [
    `cd ${shellQuote(dir)}`,
    // ssh has no Wayland display of its own: the session's, for popovers. Shell text, not a template.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the remote shell expands it.
    'export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-$(basename "$(ls -d "$XDG_RUNTIME_DIR"/wayland-[0-9] 2>/dev/null | head -1)")}"',
    `exec /usr/libexec/dashi/bin/bun ${shellQuote(join(sdk, "src/cli/main.ts"))} dev`,
  ].join(" && ");
}

async function forward(stream: ReadableStream<Uint8Array>, log: MessageLog): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith(LOG_MARK)) {
        if (line.trim()) console.error(line);
        continue;
      }
      const rest = line.slice(LOG_MARK.length);
      const direction = rest.startsWith("in ") ? "in" : "out";
      const text = log.describe(direction, rest.slice(direction.length + 1));
      if (text) console.log(`  ${text}`);
    }
  }
}

export async function dev(dir: string, args: readonly string[]): Promise<number> {
  const manifestPath = join(dir, "applet.json");
  if (!existsSync(manifestPath)) {
    console.error("dashi-applet dev: no applet.json here (make one with `dashi-applet new NAME`)");
    return 1;
  }
  if (args.includes("--vm")) {
    const command = vmCommand(dir, sdkPaths().applet);
    const vm = join(sdkPaths().applet, "../../vm/vm");
    if (!command || !existsSync(vm)) {
      console.error("dashi-applet dev --vm: the applet and the SDK must be under ~/Developer, with Dashi's checkout (vm/vm) there");
      return 1;
    }
    return await Bun.spawn([vm, "ssh", "-t", command], { stdio: ["inherit", "inherit", "inherit"] }).exited;
  }
  const manifest = readManifest(readFileSync(manifestPath, "utf8"));
  if ("error" in manifest) {
    console.error(`dashi-applet dev: applet.json: ${manifest.error}`);
    return 1;
  }
  const socket = appletsSocketPath();
  if (!socket || !existsSync(socket)) console.error("  ! no Dashi session here (no dashi-applets.sock); waiting for one, or use --vm");
  console.log(`  ${manifest.name} ${manifest.version} · watching src/ · reload on save`);
  const log = new MessageLog();
  let child: ReturnType<typeof Bun.spawn> | null = null;
  const start = (): void => {
    child = Bun.spawn([process.execPath, join(dir, manifest.entry)], {
      cwd: dir,
      env: { ...process.env, DASHI_APPLET_DEV: "1", DASHI_APPLET_LOG: "1", DASHI_APPLET_MANIFEST: manifestPath },
      stdout: "inherit",
      stderr: "pipe",
    });
    if (child.stderr instanceof ReadableStream) void forward(child.stderr, log);
  };
  const stop = async (): Promise<void> => {
    const running = child;
    child = null;
    if (!running) return;
    running.kill("SIGTERM");
    await running.exited;
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reload = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      await stop();
      console.log("  ↻ reloaded");
      start();
    }, 150);
  };
  const watchers = [watch(join(dir, "src"), { recursive: true }, reload), watch(manifestPath, reload)];
  start();
  return await new Promise<number>((resolve) => {
    process.on("SIGINT", async () => {
      for (const watcher of watchers) watcher.close();
      await stop();
      resolve(0);
    });
  });
}
