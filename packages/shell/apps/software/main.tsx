/**
 * Software (dev.dashi.software): `bun apps/software/main.tsx [host]`. Apps from
 * Flathub installed with flatpak, and the system's updates through PackageKit.
 * Nothing installs or updates until the person clicks (or an agent asks and
 * they say yes on screen). `DASHI_SOFTWARE_FAKE=1` stands in for the package
 * tools in checks (src/shared/software/stand-in.ts). `DASHI_SOFTWARE_SEARCH` opens it
 * on a search (the launcher's "Find … in Software"), `DASHI_SOFTWARE_PAGE`
 * on a place (`updates`: the daily update notice's Show; `applets`).
 * Menu bar applets are a section of it: the Applet Store folded in here.
 */

import { runPower } from "../../src/menus/session.ts";
import { runApp } from "../kit/index.ts";
import { createServices, ServicesContext } from "./lib/services.ts";
import { SOFTWARE_SIZE, SoftwareWindow } from "./lib/view.tsx";

const services = createServices(() => runPower("restart"));

runApp(
  { id: "dev.dashi.software", title: "Software", size: SOFTWARE_SIZE },
  <ServicesContext.Provider value={services}>
    <SoftwareWindow initialQuery={process.env.DASHI_SOFTWARE_SEARCH?.trim() ?? ""} initialPage={process.env.DASHI_SOFTWARE_PAGE} />
  </ServicesContext.Provider>,
);
