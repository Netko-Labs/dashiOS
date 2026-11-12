/**
 * What the applets' launcher asks of systemd (`systemd-run --user`,
 * `systemctl --user`): each applet is a transient user unit, outside the
 * shell's own processes (docs/applets.md, "The sandbox").
 */

/** What the launcher asks of systemd. */
export interface Units {
  start(unit: string, argv: readonly string[]): Promise<boolean>;
  stop(unit: string): Promise<void>;
  /**
   * Asks systemd to stop them and returns once it has been asked, without
   * waiting for them to end: all the shell can do as it exits, where nothing
   * awaited runs any more.
   */
  stopNow(units: readonly string[]): void;
}

async function run(argv: readonly string[]): Promise<boolean> {
  try {
    const child = Bun.spawn([...argv], { stdout: "ignore", stderr: "pipe" });
    const code = await child.exited;
    if (code !== 0) console.error(`dashi-shell: ${argv.slice(0, 3).join(" ")}: ${(await new Response(child.stderr).text()).trim()}`);
    return code === 0;
  } catch (error) {
    console.error(`dashi-shell: ${argv[0]}:`, error);
    return false;
  }
}

/**
 * What an applet's unit may take (docs/applets.md, "The sandbox"): half of
 * one core, 768 MB with its Metal host, and a lower priority than the
 * person's apps, so one that runs away while it answers the launcher can't
 * starve the shell or the compositor.
 */
export const UNIT_LIMITS = ["CPUQuota=50%", "MemoryMax=768M", "Nice=10"] as const;

/**
 * The session's target (session/dashi-session.target): an applet's unit is
 * part of it, so systemd stops the unit when the session ends, even when the
 * shell was killed before it could ask.
 */
export const SESSION_TARGET = "dashi-session.target";

/** `systemd-run`'s arguments for an applet's unit. */
export function startCommand(unit: string, argv: readonly string[]): string[] {
  const properties = ["Restart=on-failure", "RestartSec=3", `PartOf=${SESSION_TARGET}`, ...UNIT_LIMITS];
  return ["systemd-run", "--user", "--quiet", "--collect", `--unit=${unit}`, ...properties.flatMap((property) => ["-p", property]), "--", ...argv];
}

/** `systemctl`'s arguments to stop units without waiting for them. */
export function stopNowCommand(units: readonly string[]): string[] {
  return ["systemctl", "--user", "stop", "--no-block", ...units];
}

export const systemdUnits: Units = {
  start: (unit, argv) => run(startCommand(unit, argv)),
  stop: async (unit) => {
    await run(["systemctl", "--user", "stop", unit]);
    await run(["systemctl", "--user", "reset-failed", unit]);
  },
  stopNow: (units) => {
    if (units.length === 0) return;
    try {
      Bun.spawnSync(stopNowCommand(units), { stdout: "ignore", stderr: "ignore" });
    } catch (error) {
      console.error("dashi-shell: systemctl:", error);
    }
  },
};
