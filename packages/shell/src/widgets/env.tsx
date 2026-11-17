/** What every widget view reads besides its own data: the hub, the minute, the clock's style, the tally, and where it is drawn. */

import type { InkTokens } from "@dashi/ui";
import { createContext, useContext } from "react";
import type { TallyView } from "../tally/index.ts";
import type { WidgetHub } from "./hub.ts";

export interface WidgetEnv {
  hub: WidgetHub | null;
  /** Now, to the minute (a countdown ticks itself). */
  now: number;
  hour24: boolean;
  tally: TallyView;
  inks: InkTokens;
  /** On the lock screen: nothing opens, private parts follow each instance's choice. */
  locked: boolean;
  /** The kinds placed in this column (the Rundown leaves out what they show). */
  placedKinds: readonly string[];
  /** A press that opens something: the area closes first; on the lock screen it asks for the password ("Unlock to open Weather"). */
  open(what: { label: string; run: () => void }): void;
}

const Env = createContext<WidgetEnv | null>(null);
export const WidgetEnvProvider = Env.Provider;

export function useWidgetEnv(): WidgetEnv {
  const env = useContext(Env);
  if (!env) throw new Error("a widget outside its column");
  return env;
}
