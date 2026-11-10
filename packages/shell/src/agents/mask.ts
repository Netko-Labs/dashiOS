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

import type { CompositorWindow, Params } from "../compositor/index.ts";
import { type Atspi, limits, type Placed, passwordFields, type Rect, toWindow } from "./atspi/index.ts";
import { FillPrompts } from "./lib/fill-prompts.ts";

/** The name agents' captures use. */
export const AGENT_MASK = "agent";
/** Shell surfaces never in an agent's picture. */
export const SHEET_LAYERS = ["dashi.agent-consent"] as const;
/** Points added around a password field (window coordinates differ a little between toolkits). */
export const FIELD_PAD = 8;
/** The whole AT-SPI look before a picture: past this, what was found is used. */
const LOOK_MS = 500;
/** A browser woken for its first picture (Atspi.wake) publishes its page within this. */
const WOKEN_MS = 1200;
/** Finding a filled field again: past this, it is blanked where it was. */
const AGAIN_MS = 300;

/** A field Dashi typed a secret into, where it was, and how to find it now (AT-SPI). */
export interface FilledField {
  window: number;
  /** In its window's content coordinates, when it was typed into. */
  rect: Rect;
  again?: Placed["again"];
  /** Its page is gone: it needn't be blanked any more. */
  forget?(): void;
}

export interface MaskInputs {
  /** Fields Dashi typed a secret into (a code, a card), in their window's content coordinates. */
  filled?: ReadonlyArray<{ window: number; rect: Rect }>;
  /** Windows handed to the person. */
  handedOver: readonly number[];
  /** The vault's windows. */
  vault: readonly number[];
  /** Password fields, in their window's content coordinates. */
  fields: ReadonlyArray<{ window: number; rect: Rect }>;
  /** Screencopy clients recording for an agent. */
  pids: readonly number[];
  /** Windows Dashi just typed a card or a password into: their popups are blanked (fill-prompts.ts). */
  popups?: readonly number[];
  /** Windows their apps opened since: blanked whole. */
  opened?: readonly number[];
}

/** The `capture-mask` request for `inputs`. */
export function maskRequest(inputs: MaskInputs): Params<"capture-mask"> {
  return {
    client: AGENT_MASK,
    windows: [...new Set([...inputs.handedOver, ...inputs.vault, ...(inputs.opened ?? [])])],
    rects: [...inputs.fields, ...(inputs.filled ?? [])].map(({ window, rect }) => ({
      window,
      x: Math.floor(rect.x - FIELD_PAD),
      y: Math.floor(rect.y - FIELD_PAD),
      width: Math.ceil(rect.width + 2 * FIELD_PAD),
      height: Math.ceil(rect.height + 2 * FIELD_PAD),
    })),
    layers: [...SHEET_LAYERS],
    pids: [...inputs.pids],
    popups: [...(inputs.popups ?? [])],
  };
}

export interface MaskDeps {
  captureMask(params: Params<"capture-mask">): Promise<unknown>;
  windows(): Promise<CompositorWindow[]>;
  /** The accessibility bus, joined on first use; null where there is none. */
  atspi(): Promise<(Pick<Atspi, "appFor"> & Partial<Pick<Atspi, "wake">>) | null>;
  handedOver(): readonly number[];
  /** Fields Dashi typed a secret into, still blanked. */
  filled?(): readonly FilledField[];
  /** Whether a window is one of the vault's (Settings showing Passwords). */
  isVault(window: CompositorWindow): boolean;
}

export class AgentMask {
  private recorders: number[] = [];
  /** What an app may show back after a fill (its popups, a new window). */
  readonly prompts: FillPrompts;

  constructor(private readonly deps: MaskDeps) {
    this.prompts = new FillPrompts(() => deps.windows());
  }

  /** A recorder runs for an agent (its pid), or stopped (null). */
  recording(pid: number | null): void {
    this.recorders = pid === null ? [] : [pid];
  }

  /** Look again and tell dashi-comp; throws if it can't be told (then no picture may be taken). */
  async update(): Promise<void> {
    const all = await this.deps.windows();
    const windows = all.filter((w) => w.state === "normal" && w.frame !== null);
    const fields = await this.passwordFields(windows);
    const filled = await this.filledFields(windows);
    const prompts = this.prompts.blank(all);
    const request = maskRequest({
      handedOver: this.deps.handedOver(),
      vault: windows.filter((w) => this.deps.isVault(w)).map((w) => w.id),
      fields,
      filled,
      pids: this.recorders,
      popups: prompts.popups,
      opened: prompts.windows,
    });
    await this.deps.captureMask(request);
  }

  /**
   * Where the fields Dashi filled are now: they follow the page as it
   * scrolls, are left out while hidden (another tab), and are forgotten once
   * their page is gone. A field that can't be found in time is blanked where it was.
   */
  private async filledFields(windows: readonly CompositorWindow[]): Promise<Array<{ window: number; rect: Rect }>> {
    const found = await Promise.all(
      (this.deps.filled?.() ?? []).map(async (field) => {
        // A field still around (even one now gone) keeps its window's prompts blanked a while.
        this.prompts.touched(field.window);
        const window = windows.find((w) => w.id === field.window);
        if (!field.again || !window?.frame) return [field];
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AGAIN_MS));
        const now = await Promise.race([field.again().catch(() => null), timeout]);
        if (now === "gone") {
          field.forget?.();
          return [];
        }
        if (now === "hidden") return [];
        if (!now?.rect) return [field];
        const content = { width: window.frame.width, height: window.frame.height - window.titleBar };
        return [{ window: field.window, rect: toWindow(now.rect, now.page, content) }];
      }),
    );
    return found.flat().map(({ window, rect }) => ({ window, rect }));
  }

  private async passwordFields(windows: readonly CompositorWindow[]): Promise<Array<{ window: number; rect: Rect }>> {
    const atspi = await this.deps.atspi().catch(() => null);
    if (!atspi) return [];
    const byPid = new Map<number, CompositorWindow[]>();
    for (const window of windows) {
      if (window.pid !== null) byPid.set(window.pid, [...(byPid.get(window.pid) ?? []), window]);
    }
    const found = await Promise.all(
      [...byPid].map(async ([pid, appWindows]) => {
        // A browser that publishes nothing yet is woken first (Atspi.wake), or its password fields would go unseen.
        if (await atspi.wake?.(pid).catch(() => false)) await Bun.sleep(WOKEN_MS);
        const app = await atspi.appFor(pid).catch(() => null);
        if (!app) return [];
        const { rects } = await passwordFields(app, limits(LOOK_MS));
        // AT-SPI doesn't say which of an app's windows a field is in: each of them gets it, placed by its page.
        return appWindows.flatMap((window) => {
          const content = { width: window.frame?.width ?? 0, height: (window.frame?.height ?? 0) - window.titleBar };
          return rects.map(({ rect, page }) => ({ window: window.id, rect: toWindow(rect, page, content) }));
        });
      }),
    );
    return found.flat();
  }
}
