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

  /** `touched` hears each site the call was let use. */
  run(touched: (site: string) => void = () => {}): RunContext["browser"] {
    const session = this;
    return {
      link: () => this.bridge.current(),
      whenConnected: (ms) => this.bridge.whenConnected(ms),
      allowSite: async (site) => {
        const allowed = await this.sites.allow(site);
        if (allowed) touched(site);
        return allowed;
      },
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
