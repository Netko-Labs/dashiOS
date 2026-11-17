/**
 * Outside extensions' widgets (decisions.md D404): what installed, allowed
 * and not disabled extensions declare in applet.json, and each one's tree:
 * the extension's own `widgets/<id>.json` in its data folder when it wrote
 * one, else the package's `assets/widgets/<id>.json`. The data folders are
 * watched, so a write redraws the widget; a tree that does not parse is
 * drawn as "This widget can't be shown".
 */

import { existsSync, mkdirSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";
import { appletDataRoot, appletsRoot, type InstalledApplet, isRefusal, parseWidgetTree, readInstalled, shouldRun, type ViewNode } from "@dashi/applet";
import type { WidgetInfo, WidgetSize } from "../../types.ts";
import { Source } from "./source.ts";

export interface ExtensionWidget {
  info: WidgetInfo;
  appletId: string;
  widgetId: string;
  /** The tree to draw, or why there is none. */
  tree: ViewNode | { error: string };
}

/** The kind an extension's widget is placed as. */
export const extensionKind = (appletId: string, widgetId: string): `ext:${string}` => `ext:${appletId}/${widgetId}`;

const MAX_TREE_BYTES = 64 * 1024;

function readTree(paths: readonly string[]): ViewNode | { error: string } {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const text = readFileSync(path, "utf8");
      if (text.length > MAX_TREE_BYTES) return { error: "too big" };
      const parsed = parseWidgetTree(JSON.parse(text));
      return isRefusal(parsed) ? { error: parsed.error } : parsed;
    } catch {
      return { error: "not JSON" };
    }
  }
  return { error: "no tree yet" };
}

export function extensionWidgets(applets: readonly InstalledApplet[], dataRoot: string): ExtensionWidget[] {
  return applets.filter(shouldRun).flatMap((applet) =>
    (applet.manifest.widgets ?? []).map((widget) => ({
      info: {
        kind: extensionKind(applet.manifest.id, widget.id),
        name: widget.title,
        // An extension cannot ask for an ink (round five, #30).
        ink: null,
        glyph: "puzzle" as const,
        sizes: widget.sizes as WidgetSize[],
        holdsPrivate: widget.privacy !== "none",
        blurb: `From ${applet.manifest.name}`,
      },
      appletId: applet.manifest.id,
      widgetId: widget.id,
      tree: readTree([join(dataRoot, applet.manifest.id, "widgets", `${widget.id}.json`), join(applet.dir, "assets", "widgets", `${widget.id}.json`)]),
    })),
  );
}

export class ExtensionWidgets extends Source<readonly ExtensionWidget[]> {
  constructor(
    private readonly root: string = appletsRoot(),
    private readonly dataRoot: string = appletDataRoot(),
  ) {
    super([]);
  }

  reload(): void {
    try {
      this.set(extensionWidgets(readInstalled(this.root), this.dataRoot));
    } catch {
      this.set([]);
    }
  }

  /** Reads now, and again whenever an extension is installed or writes a tree. */
  start(): () => void {
    this.reload();
    const watchers: { close(): void }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.reload(), 300);
    };
    for (const dir of [this.root, this.dataRoot])
      try {
        mkdirSync(dir, { recursive: true });
        watchers.push(watch(dir, { recursive: true }, soon));
      } catch {
        // No folder to watch: read at start only.
      }
    return () => {
      clearTimeout(timer);
      for (const each of watchers) each.close();
    };
  }
}
