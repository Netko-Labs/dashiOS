/**
 * The one element set an extension's tree is made of (docs/launcher-extensions.md,
 * "The elements"): what the launcher draws for a command's view, and what a
 * widget is drawn from (dashi-0.9.0-design/widgets/api.md § 4). Each element
 * is named once, here, with the props it may carry and what it may hold.
 *
 * - **Shared** (launcher views and widgets): `Text`, `Image`, `Tag`, `Label`,
 *   `Link`, `Action`. A widget and a launcher view say the same thing the same
 *   way: a tag is a `Tag` with a tone in both.
 * - **Launcher only**: `List`, `Grid`, `Section`, `Item`, `Detail`, `Metadata`,
 *   `TagList`, `Separator`, `ActionPanel`, `ActionSection`, `EmptyView`.
 *   A widget's own (`gauge`, `spark`, `date`, …) are added beside these when
 *   widgets are built, and refused in the launcher.
 *
 * A prop's kind says how it is checked (tree.ts): `text` is words a person
 * reads (trimmed, no control characters, at most `max`), `long` may be empty
 * and hold new lines (Markdown), `word` one of `of`, `words` a short list of
 * `text`, `flag` true or false, `count` a whole number.
 */

/** The ink a tone is drawn in: Dashi's tokens for the mode drawn (widgets/api.md § 4.3), so Light, Dark and a theme are right. */
export const TONES = ["primary", "secondary", "tertiary", "accent", "ume", "broth", "moss"] as const;
export type Tone = (typeof TONES)[number];

/**
 * What an action does. `open`, `copy`, `paste` and `set` (ask the person for the preference named by
 * `target`, in the field) run in the shell, never in the extension (it only hears they ran); `push`
 * and `run` run in the extension.
 */
export const ACTION_KINDS = ["open", "copy", "paste", "set", "push", "run"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type PropSpec =
  | { kind: "text"; max: number; required?: true }
  | { kind: "long"; max: number; required?: true }
  | { kind: "word"; of: readonly string[]; required?: true }
  | { kind: "words"; max: number; each: number }
  | { kind: "flag" }
  | { kind: "count"; min: number; max: number };

export interface ElementSpec {
  /** Shared with widgets, or the launcher's own. */
  shared: boolean;
  props: Readonly<Record<string, PropSpec>>;
  /** The elements it may hold; empty: none. */
  holds: readonly string[];
}

const text = (max: number, required?: true): PropSpec => ({ kind: "text", max, ...(required ? { required } : {}) });
const tone: PropSpec = { kind: "word", of: TONES };
/** A key, as the manifest's and the launcher's ("mod+c", "shift+mod+c", "mod+enter"). */
const shortcut: PropSpec = { kind: "text", max: 32 };

const ACCESSORIES = ["Tag", "Text"] as const;

export const ELEMENTS = {
  // Shared with widgets.
  Text: { shared: true, props: { text: text(400, true), tone }, holds: [] },
  /** A picture: one of the package's own files (`src`, PNG or SVG), an SVG glyph drawn in a tone's ink (the menu bar glyph's rules), or an emoji. */
  Image: { shared: true, props: { src: text(200), svg: { kind: "long", max: 16 * 1024 }, emoji: text(16), tone }, holds: [] },
  Tag: { shared: true, props: { text: text(40, true), tone }, holds: [] },
  /** A label and its value, as a facts column's row. */
  Label: { shared: true, props: { title: text(40, true), text: text(200, true) }, holds: [] },
  /** A label and a link: an https:// address or a dashi:// one. */
  Link: { shared: true, props: { title: text(40, true), text: text(200, true), target: text(2048, true) }, holds: [] },
  /** Something the person can do: `open` a `target`, `copy` or `paste` its `content`, `push` a view, or `run` in the extension. */
  Action: {
    shared: true,
    props: {
      title: text(60, true),
      kind: { kind: "word", of: ACTION_KINDS, required: true },
      target: text(2048),
      content: { kind: "long", max: 16 * 1024 },
      shortcut,
      danger: { kind: "flag" },
    },
    holds: [],
  },
  // The launcher's own.
  List: {
    shared: false,
    props: { filter: { kind: "word", of: ["launcher", "extension"] }, placeholder: text(60), loading: { kind: "flag" }, more: { kind: "flag" } },
    holds: ["Section", "Item", "EmptyView", "ActionPanel"],
  },
  /** Cells of an image or emoji with a title; `columns` from 4 to 12 a row. */
  Grid: {
    shared: false,
    props: {
      filter: { kind: "word", of: ["launcher", "extension"] },
      placeholder: text(60),
      loading: { kind: "flag" },
      columns: { kind: "count", min: 4, max: 12 },
      more: { kind: "flag" },
    },
    holds: ["Section", "Item", "EmptyView", "ActionPanel"],
  },
  Section: { shared: false, props: { title: text(60), subtitle: text(40) }, holds: ["Item"] },
  /** A row of a list, or a cell of a grid (`Image` its picture, `Tag` and `Text` its accessories, `Detail` shown beside it). */
  Item: {
    shared: false,
    props: { title: text(120, true), subtitle: text(120), keywords: { kind: "words", max: 16, each: 60 } },
    holds: ["Image", ...ACCESSORIES, "ActionPanel", "Detail"],
  },
  /** Markdown (headings, lists, code, links, the package's images; no HTML) and a facts column. */
  Detail: { shared: false, props: { markdown: { kind: "long", max: 32 * 1024 }, loading: { kind: "flag" } }, holds: ["Metadata", "ActionPanel"] },
  Metadata: { shared: false, props: {}, holds: ["Label", "Link", "TagList", "Separator"] },
  TagList: { shared: false, props: { title: text(40, true) }, holds: ["Tag"] },
  Separator: { shared: false, props: {}, holds: [] },
  ActionPanel: { shared: false, props: { title: text(80) }, holds: ["Action", "ActionSection"] },
  ActionSection: { shared: false, props: { title: text(60) }, holds: ["Action"] },
  EmptyView: { shared: false, props: { title: text(80, true), description: text(200) }, holds: ["Image", "ActionPanel"] },
} as const satisfies Record<string, ElementSpec>;

export type ElementType = keyof typeof ELEMENTS;

/** The elements a view's root may be. */
export const ROOTS: readonly ElementType[] = ["List", "Grid", "Detail"];

export const isElementType = (value: unknown): value is ElementType => typeof value === "string" && Object.hasOwn(ELEMENTS, value);

/** A tree's limits (docs/launcher-extensions.md, "Limits"): the nodes, how deep, and the bytes of one message (the channel's line). */
export const TREE_LIMITS = {
  nodes: 2000,
  depth: 12,
  bytes: 64 * 1024,
  /** How often the SDK sends a changed tree at most: the channel takes 30 messages a second. */
  sendEveryMs: 50,
} as const;
