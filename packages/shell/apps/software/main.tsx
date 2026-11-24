/**
 * The Store (dev.dashi.software; called Software until 0.9, D324): `bun
 * apps/software/main.tsx [host]`. Apps from Flathub (flatpak), Fedora, Terra
 * and the COPRs enabled on the machine (PackageKit), Dashi's add-ons, and
 * the system's updates.
 * Nothing installs or updates until the person clicks (or an agent asks and
 * they say yes on screen). `DASHI_SOFTWARE_FAKE=1` stands in for the package
 * tools in checks (src/shared/software/stand-in.ts). `DASHI_SOFTWARE_SEARCH` opens it
 * on a search (the launcher's "Find … in Software"), `DASHI_SOFTWARE_PAGE`
 * on a place (`updates`: the daily update notice's Show; `applets`).
 * Menu bar applets are a section of it: the Applet Store folded in here.
 */

import { powerMachine } from "../../src/shared/logind/index.ts";
import { powerAction } from "../../src/shared/session-power/index.ts";
import { runApp } from "../kit/index.ts";
import { createServices, ServicesContext } from "./lib/services.ts";
import { SOFTWARE_SIZE, SoftwareWindow } from "./lib/view.tsx";

const services = createServices(
  () => powerAction("restart", undefined, powerMachine),
  () => powerAction("logout", undefined, powerMachine),
);

runApp(
  { id: "dev.dashi.software", title: "Store", size: SOFTWARE_SIZE, minSize: { width: 520, height: 360 } },
  <ServicesContext.Provider value={services}>
    <SoftwareWindow initialQuery={process.env.DASHI_SOFTWARE_SEARCH?.trim() ?? ""} initialPage={process.env.DASHI_SOFTWARE_PAGE} />
  </ServicesContext.Provider>,
);
