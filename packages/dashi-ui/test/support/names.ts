/**
 * Pressables without a name, in a tree as the Metal host gets it: a view
 * with `onPress` is a button to a screen reader and to an agent's
 * read_window (mirin's `access/tree.rs`), named by its `accessibilityLabel`,
 * else by the text inside it. One with neither is a button nobody can name:
 * an icon that forgot its label. The test that renders every @dashi/ui
 * pressable fails on one (pressable-names.test.tsx).
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

interface Node {
  type: string;
  props: Record<string, unknown>;
  children: unknown[];
}

const asNode = (value: unknown): Node | null =>
  isRecord(value) && typeof value.type === "string" && isRecord(value.props) && Array.isArray(value.children)
    ? { type: value.type, props: value.props, children: value.children }
    : null;

/** The words a node shows: its texts' strings, and labels of what it holds. */
function words(node: Node): string {
  return node.children
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      const inner = asNode(child);
      if (!inner) return "";
      const access = isRecord(inner.props.access) ? inner.props.access : null;
      return typeof access?.label === "string" ? access.label : words(inner);
    })
    .join("")
    .trim();
}

/** The ids of pressable views with no name, in the host's tree (JSON as sent). */
export function unnamedPressables(tree: string): string[] {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    const node = asNode(value);
    if (!node) return;
    const access = isRecord(node.props.access) ? node.props.access : null;
    const label = typeof access?.label === "string" ? access.label.trim() : "";
    if (node.type === "view" && node.props.onPress === true && !label && !words(node)) found.push(String(node.props.id));
    for (const child of node.children) visit(child);
  };
  visit(JSON.parse(tree));
  return found;
}
