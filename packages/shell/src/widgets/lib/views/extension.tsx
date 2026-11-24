/** An outside extension's widget, drawn from its tree in Dashi's type and plain ink (it cannot ask for an ink, #30); private nodes blank on the lock screen. */

import type { ViewNode } from "@dashi/applet";
import { SPACE, TYPE } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { DotRow } from "../../../shared/inks/index.ts";
import { useCard, useRedacted } from "../../look.tsx";
import { Blank, Grow, Head, Lab, Meta, Num, Words } from "../../parts.tsx";
import type { ExtensionWidget } from "../sources/extensions.ts";

const prop = (node: ViewNode, name: string): string => {
  const value = node.p[name];
  return typeof value === "string" ? value : "";
};
const count = (node: ViewNode, name: string, fallback: number): number => {
  const value = node.p[name];
  return typeof value === "number" ? value : fallback;
};

function Node({ node }: { node: ViewNode }) {
  const c = useCard();
  const redacted = useRedacted();
  switch (node.t) {
    case "Row":
    case "Column":
      return (
        <View
          style={{ flexDirection: node.t === "Row" ? "row" : "column", gap: count(node, "gap", SPACE.s), alignItems: node.t === "Row" ? "center" : "stretch" }}
        >
          {node.c.map((child) => (
            <Node key={child.i} node={child} />
          ))}
        </View>
      );
    case "Spacer":
      return <Grow />;
    case "Value":
      return node.p.private === true && redacted ? (
        <Blank what="Value" width={60} />
      ) : (
        <Num value={prop(node, "text")} unit={prop(node, "unit")} size={64} plain />
      );
    case "Dots":
      return <DotRow count={count(node, "count", 10)} value={count(node, "value", 0) / count(node, "count", 10)} radius={0.3} lit={c.ink} unlit={c.off} />;
    case "Text":
      return node.p.private === true && redacted ? <Blank width={90} /> : <Words>{prop(node, "text")}</Words>;
    case "Tag":
      return <Meta>{prop(node, "text")}</Meta>;
    case "Label":
      return (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Words>{prop(node, "title")}</Words>
          <Words ink>{prop(node, "text")}</Words>
        </View>
      );
    case "Image": {
      const svg = prop(node, "svg");
      return svg ? <Svg markup={svg} size={14} color={c.secondary} /> : <Text style={{ fontSize: TYPE.body.size }}>{prop(node, "emoji")}</Text>;
    }
    default:
      return null;
  }
}

export function ExtensionView({ widget }: { widget: ExtensionWidget | undefined }) {
  if (!widget)
    return (
      <>
        <Head left={<Lab>Extension</Lab>} />
        <Grow />
        <Words>This widget's extension is gone</Words>
      </>
    );
  const { tree } = widget;
  if ("error" in tree)
    return (
      <>
        <Head left={<Lab>{widget.info.name}</Lab>} />
        <Grow />
        <Words>This widget can't be shown</Words>
      </>
    );
  return (
    <>
      <Head left={<Lab>{prop(tree, "title") || widget.info.name}</Lab>} right={prop(tree, "detail") ? <Meta>{prop(tree, "detail")}</Meta> : undefined} />
      <View style={{ height: 10 }} />
      <View style={{ flex: 1, flexDirection: "column", gap: SPACE.s }}>
        {tree.c.map((child) => (
          <Node key={child.i} node={child} />
        ))}
      </View>
    </>
  );
}
