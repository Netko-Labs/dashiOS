/**
 * One editing session's state and its keys: the widget chosen in the
 * column, the size it had before a resize, and the gallery (open or not,
 * the widget chosen in its list, the size picked among its previews). The
 * area holds it, so the column and the gallery beside it share it and one
 * view hears the keys for both.
 *
 * The keys come to a single `onKeyDown` view that is there for the whole
 * session: Metal gives a key-taking view the keyboard when it appears, so a
 * second one (the gallery's, say) would take it and keep it after it went.
 */

import { View } from "@mirinjs/metal";
import { useState } from "react";
import { DASHI_WIDGETS, widgetInfo } from "./catalog.ts";
import { previewSizes } from "./gallery.tsx";
import type { WidgetHub } from "./hub.ts";
import { useSource } from "./lib/data.ts";
import { editKey, galleryKey, hostKey } from "./lib/edit-keys.ts";
import type { Placement, WidgetInfo, WidgetSize } from "./types.ts";

export interface EditSession {
  infos: readonly WidgetInfo[];
  chosen: string | null;
  from: WidgetSize | null;
  sizesOf(placement: Placement): readonly WidgetSize[];
  choose(id: string | null): void;
  resize(placement: Placement, size: WidgetSize): void;
  remove(id: string): void;
  move(id: string, to: number): void;
  gallery: {
    open: boolean;
    toggle(): void;
    close(): void;
    /** Every widget there is, in the list's order: Dashi's, then the extensions'. */
    all: readonly WidgetInfo[];
    kind: string | undefined;
    sizeAt: number;
    pick(kind: string): void;
  };
  key(event: { key: string; alt: boolean; shift: boolean; ctrl?: boolean }): void;
}

/** The gallery's list order: Dashi's widgets, then those from extensions. */
function listed(all: readonly WidgetInfo[]): WidgetInfo[] {
  return [...all.filter((each) => !each.kind.startsWith("ext:")), ...all.filter((each) => each.kind.startsWith("ext:"))];
}

/** `hub` is the area's (the session is made beside the env, not under it). */
export function useEditSession(hub: WidgetHub | null, placements: readonly Placement[], onDone: () => void): EditSession {
  const infos = useSource(hub?.extensions, []).map((each) => each.info);
  const store = hub?.store;
  const all = listed([...DASHI_WIDGETS, ...infos]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [from, setFrom] = useState<WidgetSize | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string | undefined>(all.find((info) => info.kind === "weather")?.kind ?? all[0]?.kind);
  const [sizeAt, setSizeAt] = useState(0);
  const sizesOf = (placement: Placement) => widgetInfo(placement.kind, infos)?.sizes ?? [placement.size];
  const choose = (id: string | null) => {
    setChosen(id);
    setFrom(null);
  };
  const resize = (placement: Placement, size: WidgetSize) => {
    if (from === null || chosen !== placement.id) setFrom(placement.size);
    setChosen(placement.id);
    store?.update(placement.id, { size });
  };
  const pick = (next: string) => {
    setKind(next);
    setSizeAt(0);
  };
  const editing = (pressed: ReturnType<typeof hostKey>) => {
    const said = editKey(placements, chosen, pressed, sizesOf);
    if (said.do === "done") onDone();
    else if (said.do === "select") choose(said.id);
    else if (said.do === "move") store?.move(said.id, said.to);
    else if (said.do === "remove") store?.remove(said.id);
    else if (said.do === "resize") {
      const placement = placements.find((each) => each.id === said.id);
      if (placement) resize(placement, said.size);
    }
  };
  const key = (event: { key: string; alt: boolean; shift: boolean; ctrl?: boolean }) => {
    const pressed = hostKey(event);
    if (!open) return editing(pressed);
    const info = all.find((each) => each.kind === kind);
    const said = galleryKey(
      all.map((each) => each.kind),
      kind,
      info ? previewSizes(info) : [],
      sizeAt,
      pressed,
    );
    if (said.do === "close") setOpen(false);
    else if (said.do === "choose") pick(said.kind);
    else if (said.do === "size") setSizeAt(said.sizeAt);
    else if (said.do === "add" && info) void store?.add(info.kind, said.size);
    else editing(pressed);
  };
  return {
    infos,
    chosen,
    from,
    sizesOf,
    choose,
    resize,
    remove: (id) => store?.remove(id),
    move: (id, to) => store?.move(id, to),
    gallery: { open, toggle: () => setOpen(!open), close: () => setOpen(false), all, kind, sizeAt, pick },
    key,
  };
}

/** The view that hears the session's keys: no size, there from the first frame of editing to Done. */
export function EditKeys({ session }: { session: EditSession }) {
  return (
    <View
      testID="widget-edit-keys"
      onKeyDown={(event) => session.key(event)}
      style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0 }}
    />
  );
}
