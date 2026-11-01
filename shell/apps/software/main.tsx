/**
 * Software (dev.dashi.software): `bun apps/software/main.tsx [host]`. Apps from
 * Flathub installed with flatpak, and the system's updates through PackageKit.
 * Nothing installs or updates until the person clicks (or an agent asks and
 * they say yes on screen). `DASHI_SOFTWARE_FAKE=1` stands in for the package
 * tools in checks (src/software/stand-in.ts).
 */

import { runPower } from "../../src/menus/session.ts";
import { runApp } from "../kit/index.ts";
import { createServices, ServicesContext } from "./services.ts";
import { SOFTWARE_SIZE, SoftwareWindow } from "./view.tsx";

const services = createServices(() => runPower("restart"));

runApp(
  { id: "dev.dashi.software", title: "Software", size: SOFTWARE_SIZE },
  <ServicesContext.Provider value={services}>
    <SoftwareWindow />
  </ServicesContext.Provider>,
);
