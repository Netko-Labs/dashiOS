/** The one marquee of a browser (session.ts): its listing draws it, its views say where the items are, and its keys end it. */

import { Marquee } from "./session.ts";
import type { MarqueeStore } from "./types.ts";

const sessions = new WeakMap<MarqueeStore, Marquee>();

export function marqueeOf(store: MarqueeStore): Marquee {
  let session = sessions.get(store);
  if (!session) {
    session = new Marquee(store);
    sessions.set(store, session);
  }
  return session;
}
