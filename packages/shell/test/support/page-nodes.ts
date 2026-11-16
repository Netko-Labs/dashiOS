/** Made-up page trees for the extension's pure reader (page/*.ts): a spec becomes a PageNode. */

import type { PageNode, PageOption } from "../../browser-extension/src/page/node.ts";
import { secrecyOf } from "../../browser-extension/src/page/node.ts";

export interface Spec {
  tag: string;
  attrs?: Record<string, string>;
  children?: Array<Spec | string>;
  value?: string;
  checked?: boolean;
  options?: PageOption[];
  label?: string;
  href?: string;
  hidden?: boolean;
  inline?: boolean;
  wasPassword?: boolean;
  dashiFilled?: boolean;
}

const BLOCKS = new Set([
  "div",
  "p",
  "h1",
  "h2",
  "h3",
  "form",
  "section",
  "main",
  "body",
  "ul",
  "li",
  "table",
  "tr",
  "nav",
  "header",
  "footer",
  "aside",
  "article",
]);

/** Every value read, so a test can say no secret was. */
export const values: { read: string[] } = { read: [] };

export function node(spec: Spec | string): PageNode {
  if (typeof spec === "string") {
    return {
      tag: "#text",
      text: () => spec,
      attr: () => null,
      children: () => [],
      shown: () => true,
      block: () => false,
      value: () => "",
      hasValue: () => false,
      checked: () => false,
      options: () => [],
      labelText: () => null,
      href: () => null,
      disabled: () => false,
      wasPassword: () => false,
      dashiFilled: () => false,
      labelsField: () => false,
    };
  }
  const kids = (spec.children ?? []).map(node);
  const self: PageNode = {
    tag: spec.tag,
    text: () => "",
    attr: (name) => spec.attrs?.[name] ?? null,
    children: () => kids,
    shown: () => !spec.hidden,
    block: () => !spec.inline && BLOCKS.has(spec.tag),
    value: () => {
      if (secrecyOf(self)) throw new Error(`a secret field's value was read: ${spec.value}`);
      values.read.push(spec.value ?? "");
      return spec.value ?? "";
    },
    hasValue: () => (spec.value ?? "").length > 0,
    checked: () => spec.checked === true,
    options: () => spec.options ?? [],
    labelText: () => spec.label ?? null,
    href: () => spec.href ?? null,
    disabled: () => spec.attrs?.disabled !== undefined,
    wasPassword: () => spec.wasPassword === true,
    dashiFilled: () => spec.dashiFilled === true,
    labelsField: () => spec.tag === "label" && spec.attrs?.for !== undefined,
  };
  return self;
}

/** Numbers as content.ts gives them: the same node, the same number, for the document's life. */
export function numbering(): (n: PageNode) => number {
  const numbers = new Map<PageNode, number>();
  return (n: PageNode) => {
    let ref = numbers.get(n);
    if (ref === undefined) {
      ref = numbers.size + 1;
      numbers.set(n, ref);
    }
    return ref;
  };
}

/** A frame's text with its own numbers, as the background renumbers them. */
