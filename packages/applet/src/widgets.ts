/**
 * Widgets an extension adds (decisions.md D404, widgets/api.md § 2): declared
 * in applet.json, so the gallery lists them before the extension has ever
 * run, and drawn by the shell from a tree of Dashi's own elements
 * (view/elements.ts) in Dashi's type and plain ink. Never pixels.
 *
 *   "widgets": [
 *     { "id": "lights", "title": "Lights", "sizes": ["small", "wide"], "privacy": "none" }
 *   ]
 *
 * The tree is a file: the package's `assets/widgets/<id>.json` until the
 * extension writes its own `widgets/<id>.json` in its data folder (its home
 * in the sandbox), which the shell watches and redraws, so a widget is live
 * without a new message on the channel.
 */

import { id, isRefusal, list, type Refusal, record, refuse, text } from "@dashi/shape/kit";

export const WIDGET_SIZES = ["mini", "compact", "small", "strip", "wide", "tall", "large"] as const;
export type AppletWidgetSize = (typeof WIDGET_SIZES)[number];
export const WIDGET_PRIVACY = ["none", "some", "all"] as const;

export interface AppletWidget {
  id: string;
  title: string;
  /** The sizes it offers; the first is the one it is added in. */
  sizes: AppletWidgetSize[];
  /** What it holds that is the person's: "none", "some" (its `private` nodes), "all". */
  privacy: (typeof WIDGET_PRIVACY)[number];
}

function parseWidget(value: unknown, where: string): AppletWidget | Refusal {
  const fields = record(value, where, ["id", "title", "sizes", "privacy"] as const);
  if (isRefusal(fields)) return fields;
  const widgetId = id(fields.id, `${where}: id`, 40);
  if (isRefusal(widgetId)) return widgetId;
  const title = text(fields.title, `${where}: title`, 40);
  if (isRefusal(title)) return title;
  const sizes = list(
    fields.sizes ?? ["small"],
    `${where}: sizes`,
    WIDGET_SIZES.length,
    (entry, at) => WIDGET_SIZES.find((size) => size === entry) ?? refuse(`${at} must be one of ${WIDGET_SIZES.join(", ")}`),
  );
  if (isRefusal(sizes)) return sizes;
  if (sizes.length === 0) return refuse(`${where}: sizes is empty`);
  const privacy = fields.privacy === undefined ? "some" : WIDGET_PRIVACY.find((each) => each === fields.privacy);
  if (privacy === undefined) return refuse(`${where}: privacy must be one of ${WIDGET_PRIVACY.join(", ")}`);
  return { id: widgetId, title, sizes, privacy };
}

export function parseWidgets(value: unknown): AppletWidget[] | Refusal {
  const widgets = list(value, "widgets", 8, parseWidget);
  if (isRefusal(widgets)) return widgets;
  const ids = widgets.map((widget) => widget.id);
  const twice = ids.find((each, at) => ids.indexOf(each) !== at);
  return twice ? refuse(`widgets lists “${twice}” twice`) : widgets;
}
