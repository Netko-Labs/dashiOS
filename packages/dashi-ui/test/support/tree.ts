/** Rendering a kit control once and reading the tree Metal was sent: a node by its testID, its props. */

import { render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { fakeHost } from "../host.ts";
import { settle } from "./time.ts";

export interface SentNode {
  type: string;
  props: Record<string, unknown>;
  children?: Array<SentNode | string>;
}

function find(node: SentNode, id: string): SentNode | null {
  if (node.props?.id === id) return node;
  for (const child of node.children ?? []) {
    if (typeof child === "string") continue;
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

/** Every string drawn under a node. */
export function words(node: SentNode | null): string[] {
  if (!node) return [];
  return (node.children ?? []).flatMap((child) => (typeof child === "string" ? [child] : words(child)));
}

/** Render `element`, settle, and give a finder by testID, the last tree's text, the host and the root. */
export async function sent(element: ReactElement): Promise<{
  node: (testID: string) => SentNode | null;
  json: () => string;
  host: ReturnType<typeof fakeHost>;
  root: ReturnType<typeof render>;
}> {
  const host = fakeHost();
  const root = render(element, host.transport);
  await settle();
  const tree = (): SentNode => JSON.parse(host.last()) as SentNode;
  return { node: (testID) => find(tree(), root.nodeId(testID) ?? "\u0000"), json: host.last, host, root };
}
