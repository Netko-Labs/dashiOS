import type { ActionContext, ActionDef } from "../../src/actions/types.ts";
import type { CompositorWindow } from "../../src/compositor/wire.ts";

export const run = async (action: ActionDef | undefined, args: Record<string, unknown> = {}, ctx: ActionContext = { window: null }) => {
  const checked = action?.check(args);
  if (!checked) throw new Error("no action");
  return checked.ok ? checked.run(ctx) : { ok: false as const, error: checked.error };
};

export const window = (id: number, extra: Partial<CompositorWindow> = {}): CompositorWindow => ({
  id,
  appId: "dev.dashi.notes",
  title: "Groceries",
  pid: 40,
  focused: false,
  state: "normal",
  frame: null,
  titleBar: 0,
  ...extra,
});
