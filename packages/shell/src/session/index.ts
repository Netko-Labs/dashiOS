/**
 * The Dashi session: what dashi-comp runs as its `-c` command (the compositor
 * grants screen capture to that process and its descendants, so every session
 * service starts here). It tells systemd and D-Bus where the display is (when
 * dashi-session says this session owns it), starts the shell, restarts it when
 * it crashes, and ends when it is told to (SIGTERM, SIGINT) or when the
 * compositor goes away.
 */

import { captureWithTimeout, importSessionEnvironment, runWithTimeout } from "./environment.ts";
import { startKeyring } from "./keyring.ts";
import { watchCompositor } from "./parent.ts";
import { Service, type ServiceDeps, type ServiceSpec } from "./service.ts";
import { log, systemDeps } from "./system.ts";
import { startSessionTarget, stopSessionTarget } from "./target.ts";

const shellDir = new URL("../../", import.meta.url).pathname;

/** The services of a session; add the ones that should outlive the shell here. */
export function sessionServices(): ServiceSpec[] {
  return [
    {
      name: "shell",
      cmd: [process.execPath, `${shellDir}src/main.tsx`],
      cwd: shellDir,
      essential: true,
    },
  ];
}

/** Run the session to its end; resolves with the exit code. */
export async function runSession(specs: readonly ServiceSpec[] = sessionServices(), deps: ServiceDeps = systemDeps): Promise<number> {
  log(`session starting (pid ${process.pid}, WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY ?? "unset"})`);
  // Only a session that owns the display may publish it or start its keyring:
  // a nested one would point the host desktop's portals and D-Bus-activated
  // apps at itself.
  if (process.env.DASHI_IMPORT_ENVIRONMENT === "1") {
    // First, so its socket is part of what gets published.
    Object.assign(process.env, await startKeyring({ which: Bun.which, run: captureWithTimeout, log }));
    await importSessionEnvironment({ env: process.env, which: Bun.which, run: runWithTimeout, log });
    // Then the session target, which the portal and other session services need.
    await startSessionTarget({ env: process.env, which: Bun.which, run: runWithTimeout, log });
  } else {
    log("not telling systemd/D-Bus about this display (nested, or not started by dashi-session)");
  }

  const services = specs.map((spec) => new Service(spec, deps));
  let ending = false;
  const end = (reason: string) => {
    if (ending) return;
    ending = true;
    log(`session ending: ${reason}`);
    void Promise.all(services.map((service) => service.stop()));
  };

  process.on("SIGTERM", () => end("SIGTERM"));
  process.on("SIGINT", () => end("SIGINT"));
  const stopWatching = watchCompositor(() => end("dashi-comp exited"));

  let code = 0;
  await Promise.all(
    services.map(async (service) => {
      if ((await service.start()) === "gave-up" && service.spec.essential) {
        code = 1;
        log(`the ${service.spec.name} cannot be kept running, so the session is over: press Ctrl+Alt+Backspace to leave it, or Ctrl+Alt+F3 for a console`);
        end(`${service.spec.name} gave up`);
      }
    }),
  );
  stopWatching();
  if (process.env.DASHI_IMPORT_ENVIRONMENT === "1") await stopSessionTarget({ which: Bun.which, run: runWithTimeout });
  log(`session over (exit ${code})`);
  return code;
}
