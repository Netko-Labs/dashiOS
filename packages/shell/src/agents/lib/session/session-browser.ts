/** The website tools' side of one connection: the extension, its sites, its tab. */

import type { BrowserBridge } from "../../../browser/bridge.ts";
import type { RunContext } from "../../context.ts";
import type { SiteConsent } from "../../sites.ts";

export class SessionBrowser {
  /** The browser tab the website tools use when none is named: the agent's last. */
  tab: number | null = null;

  constructor(
    private readonly bridge: BrowserBridge,
    private readonly sites: SiteConsent,
  ) {}

  run(): RunContext["browser"] {
    const session = this;
    return {
      link: () => this.bridge.current(),
      whenConnected: (ms) => this.bridge.whenConnected(ms),
      allowSite: (site) => this.sites.allow(site),
      mayUse: (site) => this.sites.has(site),
      get tab() {
        return session.tab;
      },
      set tab(tab: number | null) {
        session.tab = tab;
      },
    };
  }
}
