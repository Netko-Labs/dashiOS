/**
 * What an extension writes its views with (docs/launcher-extensions.md):
 * named as Raycast names them, so a developer who knows one knows the other,
 * and rendered as the elements of view/elements.ts, which the launcher draws.
 *
 *   <List filter="launcher" placeholder="Filter pull requests">
 *     <List.Section title="Review requested">
 *       <List.Item id="42" title="Fix the dock" accessories={[{ tag: "Checks pass", tone: "moss" }]}
 *         actions={<ActionPanel><Action.Open title="Open in Browser" target={url} /></ActionPanel>} />
 *     </List.Section>
 *   </List>
 */

import { createElement, type ReactElement, type ReactNode } from "react";
import type { Tone } from "../view/elements.ts";
import type { FormValues } from "./form.tsx";

/** A picture: the package's own file, an SVG glyph drawn in a tone's ink, or an emoji. */
export type Icon = { src: string; tone?: Tone } | { svg: string; tone?: Tone } | { emoji: string };

/** Words or a tag at a row's right end. */
export type Accessory = { tag: string; tone?: Tone } | { text: string; tone?: Tone };

const h = (type: string, props: Record<string, unknown>, ...children: ReactNode[]): ReactElement => createElement(type, props, ...children);

const image = (icon: Icon | undefined): ReactNode => (icon ? h("Image", { ...icon }) : null);

const accessory = (each: Accessory, at: number): ReactNode =>
  "tag" in each ? h("Tag", { key: `a${at}`, text: each.tag, tone: each.tone }) : h("Text", { key: `a${at}`, text: each.text, tone: each.tone });

interface ListProps {
  /** `launcher`: the launcher filters the rows by what is typed; `extension`: the extension hears `onSearchTextChange` and sends the rows. */
  filter?: "launcher" | "extension";
  placeholder?: string;
  /** "Loading" in the head (after 300 ms), while the rows come. */
  loading?: boolean;
  onSearchTextChange?: (text: string) => void;
  /** The selected item's id moved. */
  onSelectionChange?: (id: string | null) => void;
  /** There are more rows: the end of the list asks for them (`onLoadMore`). */
  more?: boolean;
  onLoadMore?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}

interface SectionProps {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
}

interface ItemProps {
  /** Yours: what `onSelectionChange` says, and what keeps the selection when rows move. */
  id?: string;
  title: string;
  subtitle?: string;
  icon?: Icon;
  keywords?: readonly string[];
  accessories?: readonly Accessory[];
  actions?: ReactNode;
  /** Shown beside the list for the selected item (a list with detail). */
  detail?: ReactNode;
}

interface EmptyViewProps {
  title: string;
  description?: string;
  icon?: Icon;
  actions?: ReactNode;
}

function EmptyView({ title, description, icon, actions }: EmptyViewProps) {
  return h("EmptyView", { title, description }, image(icon), actions);
}

function Section({ title, subtitle, children }: SectionProps) {
  return h("Section", { title, subtitle }, children);
}

function ListItem({ id, title, subtitle, icon, keywords, accessories, actions, detail }: ItemProps) {
  return h("Item", { id, title, subtitle, keywords }, image(icon), ...(accessories ?? []).map(accessory), actions, detail);
}

function ListRoot({ children, actions, ...props }: ListProps) {
  return h("List", props, children, actions);
}

export const List = Object.assign(ListRoot, { Section, Item: ListItem, EmptyView });

interface GridProps extends Omit<ListProps, "onSelectionChange"> {
  /** Cells a row, 4 to 12 (8 by default). */
  columns?: number;
  onSelectionChange?: (id: string | null) => void;
}

interface GridItemProps {
  id?: string;
  title?: string;
  content: Icon;
  keywords?: readonly string[];
  actions?: ReactNode;
}

function GridItem({ id, title, content, keywords, actions }: GridItemProps) {
  return h("Item", { id, title: title ?? ("emoji" in content ? content.emoji : " "), keywords }, image(content), actions);
}

function GridRoot({ children, actions, ...props }: GridProps) {
  return h("Grid", props, children, actions);
}

export const Grid = Object.assign(GridRoot, { Section, Item: GridItem, EmptyView });

interface DetailProps {
  /** Markdown: headings, lists, code, links, the package's images; no HTML. */
  markdown?: string;
  loading?: boolean;
  metadata?: ReactNode;
  actions?: ReactNode;
}

function Label({ title, text }: { title: string; text: string }) {
  return h("Label", { title, text });
}

function MetaLink({ title, text, target }: { title: string; text: string; target: string }) {
  return h("Link", { title, text, target });
}

function TagItem({ text, tone }: { text: string; tone?: Tone }) {
  return h("Tag", { text, tone });
}

function TagListRoot({ title, children }: { title: string; children?: ReactNode }) {
  return h("TagList", { title }, children);
}

function Separator() {
  return h("Separator", {});
}

function MetadataRoot({ children }: { children?: ReactNode }) {
  return h("Metadata", {}, children);
}

const Metadata = Object.assign(MetadataRoot, { Label, Link: MetaLink, TagList: Object.assign(TagListRoot, { Item: TagItem }), Separator });

function DetailRoot({ markdown, loading, metadata, actions }: DetailProps) {
  return h("Detail", { markdown, loading }, metadata, actions);
}

export const Detail = Object.assign(DetailRoot, { Metadata });

interface ActionProps {
  title: string;
  /** A key, as "mod+c" or "shift+mod+enter": the first action is ↩ and the second ❖↩ without one. */
  shortcut?: string;
  /** Drawn in the critical colour. */
  danger?: boolean;
  onAction?: () => void;
}

function ActionRun({ title, shortcut, danger, onAction }: ActionProps) {
  return h("Action", { title, kind: "run", shortcut, danger, onAction });
}

/** Opens an https:// address in the browser, or a dashi:// one; the shell does it. */
function Open({ target, ...rest }: ActionProps & { target: string }) {
  return h("Action", { ...rest, kind: "open", target });
}

/** Copies `content`; the shell does it, so it needs no clipboard permission: the person did it. */
function Copy({ content, ...rest }: ActionProps & { content: string }) {
  return h("Action", { ...rest, kind: "copy", content });
}

/** Types `content` into the window that was in front of the launcher. */
function Paste({ content, ...rest }: ActionProps & { content: string }) {
  return h("Action", { ...rest, kind: "paste", content });
}

/** Shows `target` over this view; Esc comes back. */
function Push({ target, ...rest }: ActionProps & { target: ReactNode }) {
  return h("Action", { ...rest, kind: "push", pushes: target });
}

/** Asks the person for the preference `name` in the launcher's field, and keeps it (a secret in the Secret Service). */
function SetPreference({ name, ...rest }: ActionProps & { name: string }) {
  return h("Action", { ...rest, kind: "set", target: name });
}

/** Sends the form it is on: the launcher checks the fields first, then `onSubmit` gets their values. */
function SubmitForm({ onSubmit, ...rest }: Omit<ActionProps, "onAction"> & { onSubmit: (values: FormValues) => void | Promise<void> }) {
  return h("Action", { ...rest, kind: "submit", onSubmit });
}

/**
 * Connects the person's account at `provider` (applet.json `accounts`): the shell signs in, in Helium, and
 * keeps the token; `useAccount` has it once it is done. The first sign-in asks the person once.
 */
function ConnectAccount({ provider, ...rest }: ActionProps & { provider: string }) {
  return h("Action", { ...rest, kind: "connect", target: provider });
}

export const Action = Object.assign(ActionRun, { Open, Copy, Paste, Push, SetPreference, SubmitForm, ConnectAccount });

function ActionSection({ title, children }: { title?: string; children?: ReactNode }) {
  return h("ActionSection", { title }, children);
}

function ActionPanelRoot({ title, children }: { title?: string; children?: ReactNode }) {
  return h("ActionPanel", { title }, children);
}

export const ActionPanel = Object.assign(ActionPanelRoot, { Section: ActionSection });
