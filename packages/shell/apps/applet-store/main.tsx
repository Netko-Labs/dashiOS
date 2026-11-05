/**
 * Applet Store (dev.dashi.applet-store): `bun apps/applet-store/main.tsx [host]`.
 * Applets from the catalog (Netko-Labs/dashi-applets), checked against
 * Dashi's key and their authors' before anything is installed; the shell
 * runs what is installed in its sandbox (docs/applets.md).
 * `DASHI_APPLETS_INDEX` and `DASHI_APPLETS_KEY` point it at another catalog.
 */

import { runApp } from "../kit/index.ts";
import { createServices, ServicesContext } from "./services.ts";
import { STORE_SIZE, StoreWindow } from "./view.tsx";

runApp(
  { id: "dev.dashi.applet-store", title: "Applet Store", size: STORE_SIZE },
  <ServicesContext.Provider value={createServices()}>
    <StoreWindow />
  </ServicesContext.Provider>,
);
