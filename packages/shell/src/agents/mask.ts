/**
 * What agents' pictures blank (docs/secrets.md, "Blanked captures"): the
 * shell decides, dashi-comp paints (`capture-mask`, docs/compositor-ipc.md).
 * Before every agent screenshot and still, and through a recording:
 *
 * - every consent sheet (its layer namespace);
 * - the vault's windows (Settings while its Passwords pane shows);
 * - windows handed to the person ("Your turn"), until they press Done;
 * - every password field that is showing, found through AT-SPI, a little
 *   larger than the field.
 *
 * A field AT-SPI doesn't report isn't blanked ("Unknown fields aren't
 * blanked"); a mask that can't be set means no picture at all.
 */

import type { CompositorWindow } from "../compositor.ts";
import type { Atspi } from "./atspi/client.ts";
import { limits, passwordFields, type Rect } from "./atspi/tree.ts";

/** The name agents' captures use. */
export const AGENT_MASK = "agent";
/** Shell surfaces never in an agent's picture. */
export const SHEET_LAYERS = ["dashi.agent-consent"] as const;
/** Points added around a password field (window coordinates differ a little between toolkits). */
export const FIELD_PAD = 8;
/** The whole AT-SPI look before a picture: past this, what was found is used. */
const LOOK_MS = 500;

export interface MaskInputs {
  /** Windows handed to the person. */
  handedOver: readonly number[];
  /** The vault's windows. */
  vault: readonly number[];
  /** Password fields, in their window's content coordinates. */
  fields: ReadonlyArray<{ window: number; rect: Rect }>;
  /** Screencopy clients recording for an agent. */
  pids: readonly number[];
}

/** The `capture-mask` request for `inputs`. */
export function maskRequest(inputs: MaskInputs): Record<string, unknown> {
  return {
    client: AGENT_MASK,
    windows: [...new Set([...inputs.handedOver, ...inputs.vault])],
    rects: inputs.fields.map(({ window, rect }) => ({
      window,
      x: Math.floor(rect.x - FIELD_PAD),
      y: Math.floor(rect.y - FIELD_PAD),
      width: Math.ceil(rect.width + 2 * FIELD_PAD),
      height: Math.ceil(rect.height + 2 * FIELD_PAD),
    })),
    layers: [...SHEET_LAYERS],
    pids: [...inputs.pids],
  };
}

export interface MaskDeps {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  windows(): Promise<CompositorWindow[]>;
  /** The accessibility bus, joined on first use; null where there is none. */
  atspi(): Promise<Pick<Atspi, "appFor"> | null>;
  handedOver(): readonly number[];
  /** Whether a window is one of the vault's (Settings showing Passwords). */
  isVault(window: CompositorWindow): boolean;
}

export class AgentMask {
  private recorders: number[] = [];

  constructor(private readonly deps: MaskDeps) {}

  /** A recorder runs for an agent (its pid), or stopped (null). */
  recording(pid: number | null): void {
    this.recorders = pid === null ? [] : [pid];
  }

  /** Look again and tell dashi-comp; throws if it can't be told (then no picture may be taken). */
  async update(): Promise<void> {
    const windows = (await this.deps.windows()).filter((w) => w.state === "normal" && w.frame !== null);
    const fields = await this.passwordFields(windows);
    const request = maskRequest({
      handedOver: this.deps.handedOver(),
      vault: windows.filter((w) => this.deps.isVault(w)).map((w) => w.id),
      fields,
      pids: this.recorders,
    });
    await this.deps.request("capture-mask", request);
  }

  private async passwordFields(windows: readonly CompositorWindow[]): Promise<Array<{ window: number; rect: Rect }>> {
    const atspi = await this.deps.atspi().catch(() => null);
    if (!atspi) return [];
    const budget = limits(LOOK_MS);
    const byPid = new Map<number, number[]>();
    for (const window of windows) {
      if (window.pid !== null) byPid.set(window.pid, [...(byPid.get(window.pid) ?? []), window.id]);
    }
    const found = await Promise.all(
      [...byPid].map(async ([pid, ids]) => {
        const app = await atspi.appFor(pid).catch(() => null);
        if (!app) return [];
        const { rects } = await passwordFields(app, budget);
        // AT-SPI doesn't say which of an app's windows a field is in: each of them gets it.
        return ids.flatMap((window) => rects.map((rect) => ({ window, rect })));
      }),
    );
    return found.flat();
  }
}
