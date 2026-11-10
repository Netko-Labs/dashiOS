/**
 * A private dbus-daemon for tests: its own config in a temporary directory,
 * no service activation, nothing of the host's session. `start()` resolves
 * with its address, or null when this machine has no dbus-daemon (the test
 * then skips itself).
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { until } from "./support/time.ts";

export interface PrivateBus {
  address: string;
  stop(): void;
}

export async function startPrivateBus(prefix: string): Promise<PrivateBus | null> {
  const daemon = Bun.which("dbus-daemon");
  if (!daemon) return null;
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const socket = join(dir, "bus");
  const address = `unix:path=${socket}`;
  const config = join(dir, "bus.conf");
  writeFileSync(
    config,
    `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>${address}</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`,
  );
  const bus = Bun.spawn([daemon, "--config-file", config, "--nofork"], { stdout: "ignore", stderr: "inherit" });
  await until(() => existsSync(socket), "the bus socket");
  return {
    address,
    stop() {
      bus.kill();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
