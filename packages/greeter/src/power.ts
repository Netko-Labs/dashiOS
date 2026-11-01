/** Sleep, Restart, and Shut Down from the login screen, through logind (polkit allows the active seat). */

import type { PowerAction } from "@dashi/ui";

const VERBS: Record<PowerAction, string> = { sleep: "suspend", restart: "reboot", shutdown: "poweroff" };

export function power(what: PowerAction): void {
  const child = Bun.spawn(["systemctl", VERBS[what]], { stdout: "ignore", stderr: "pipe" });
  void child.exited.then(async (code) => {
    if (code !== 0) console.error(`dashi-greeter: systemctl ${VERBS[what]} failed:`, await new Response(child.stderr).text());
  });
}
