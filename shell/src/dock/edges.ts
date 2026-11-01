/**
 * The compositor's claim on the pointer along a screen's bottom edge (IPC
 * `edges`, comp/src/edges.rs): the autohiding Dock's eyes. A Wayland client
 * is never told that the pointer left its surface, so the compositor says
 * when the pointer enters or leaves a band of the given height:
 *
 *   → edges {bottom: 1, output: "eDP-1"}   ← {bottom: 1, inside: false}
 *   ← {"event":"edge","edge":"bottom","inside":true}
 *
 * Which band, and what entering it means, is dock/presenter.ts's.
 */

import type { Compositor } from "../compositor.ts";

export interface EdgeClaim {
  /**
   * Watch the bottom `band` px of `output` (the first screen when undefined); 0 gives the claim up.
   * Resolves to whether the pointer is in the band now (false when the compositor refused).
   */
  claim(band: number, output: string | undefined): Promise<boolean>;
}

/** What the compositor answers an `edges` request with: whether the pointer is in the band. */
export function parseClaimAnswer(answer: unknown): boolean {
  return typeof answer === "object" && answer !== null && (answer as { inside?: unknown }).inside === true;
}

export function compositorEdges(compositor: Pick<Compositor, "request">): EdgeClaim {
  return {
    async claim(band, output) {
      try {
        return parseClaimAnswer(await compositor.request("edges", { bottom: band, ...(output === undefined ? {} : { output }) }));
      } catch (error) {
        console.error("dashi-shell: dashi-comp refused the Dock's edge claim:", error instanceof Error ? error.message : error);
        return false;
      }
    },
  };
}
