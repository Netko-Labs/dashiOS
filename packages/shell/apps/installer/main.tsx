/**
 * The Installer (dev.dashi.installer): `bun apps/installer/main.tsx [host]`,
 * started from "Install Dashi" on the live USB drive (session/dashi-installer).
 * Its pages are view.tsx; the part that runs as root is dashi-live's
 * dashi-install (helper.ts).
 */

import { runApp } from "../kit/index.ts";
import { isDryRun } from "./lib/helper.ts";
import { INSTALLER_SIZE, InstallerWindow } from "./lib/view.tsx";

const app = runApp(
  { id: "dev.dashi.installer", title: "Install Dashi", size: INSTALLER_SIZE },
  <InstallerWindow
    restart={() => {
      // A practice run has nothing to start into.
      if (isDryRun()) app.quit();
      else Bun.spawn(["systemctl", "reboot"], { stdin: "ignore", stdout: "ignore", stderr: "inherit" });
    }}
  />,
);
