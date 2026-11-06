/** Made-up accessibility trees, for the AT-SPI walk and the agents' mask. */

import { type A11yNode, type Rect, ROLE, STATE } from "../../src/agents/atspi/tree.ts";

export interface Spec {
  role: number;
  states?: number[];
  rect?: Rect;
  url?: string;
  children?: Spec[];
  /** Its first GetExtents answers nothing, as Firefox's does. */
  late?: boolean;
}

/** GetState's two words with these bits set. */
export function bits(states: readonly number[]): number[] {
  const words = [0, 0];
  for (const state of states) words[state >> 5] = (words[state >> 5] ?? 0) | (1 << (state & 31));
  return words.map((word) => word >>> 0);
}

export function tree(spec: Spec): A11yNode {
  let asked = false;
  return {
    role: async () => spec.role,
    states: async () => bits(spec.states ?? []),
    children: async () => (spec.children ?? []).map(tree),
    extents: async () => {
      const early = spec.late && !asked;
      asked = true;
      return early ? null : (spec.rect ?? null);
    },
    url: async () => spec.url ?? null,
  };
}

const showing = [STATE.SHOWING];

/** A browser window: a sign-in page at `url` with a user name and a password field, the password focused. */
export function browser(url: string, options: { focus?: "user" | "password" | null; frameUrl?: string } = {}): A11yNode {
  const focus = options.focus === undefined ? "password" : options.focus;
  const fields: Spec[] = [
    { role: ROLE.ENTRY, states: [...showing, STATE.EDITABLE, ...(focus === "user" ? [STATE.FOCUSED] : [])], rect: { x: 100, y: 200, width: 240, height: 28 } },
    {
      role: ROLE.PASSWORD_TEXT,
      states: [...showing, STATE.EDITABLE, ...(focus === "password" ? [STATE.FOCUSED] : [])],
      rect: { x: 100, y: 240, width: 240, height: 28 },
    },
  ];
  const page: Spec = options.frameUrl
    ? { role: ROLE.DOCUMENT_WEB, states: showing, url, children: [{ role: ROLE.DOCUMENT_WEB, states: showing, url: options.frameUrl, children: fields }] }
    : { role: ROLE.DOCUMENT_WEB, states: showing, url, children: fields };
  return tree({
    role: ROLE.APPLICATION,
    children: [
      {
        role: ROLE.FRAME,
        states: showing,
        children: [
          page,
          // A password field on a tab that isn't showing.
          {
            role: ROLE.DOCUMENT_WEB,
            states: [],
            url: "https://other.example/",
            children: [{ role: ROLE.PASSWORD_TEXT, states: [], rect: { x: 1, y: 1, width: 9, height: 9 } }],
          },
        ],
      },
    ],
  });
}
