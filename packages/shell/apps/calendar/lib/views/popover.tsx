/**
 * A pressed event's popover, beside it: its title, when it is (and when that
 * is in its own zone, when that differs from this computer's), its calendar,
 * repeat, alert, and place, with Delete and Edit… for the full sheet. Return
 * opens the sheet, ⌫ deletes, Esc closes; pressing elsewhere closes it too.
 */

import { Button, useColors, useSurface } from "@dashi/ui";
import { type Bounds, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { Calendar, Occurrence } from "../../../../src/shared/calendar/types.ts";
import { fromHere, hereZone, isZone, zoneCity } from "../../../../src/shared/calendar/zones.ts";
import type { ClockPrefs } from "../../../../src/shared/time/clock.ts";
import { alertLabel, repeatSummary, timeSpan, titleOf } from "../format.ts";

export const POPOVER_WIDTH = 270;
const GAP = 8;

/** Where the popover goes: beside the event, on whichever side has room, kept inside `area`. */
export function popoverOrigin(event: Bounds, area: Bounds, height: number): { x: number; y: number } {
  const right = event.x + event.width + GAP;
  const x = right + POPOVER_WIDTH <= area.x + area.width ? right : Math.max(area.x + GAP, event.x - GAP - POPOVER_WIDTH);
  const y = Math.max(area.y + GAP, Math.min(event.y, area.y + area.height - height - GAP));
  return { x, y };
}

/** "9:00 – 9:30 AM in New York" when the event keeps another zone's clock; null when it is this computer's. */
export function zoneNote(occurrence: Pick<Occurrence, "event" | "start" | "end">, prefs: ClockPrefs, here: string = hereZone()): string | null {
  const { event } = occurrence;
  if (event.allDay || event.zone === null || event.zone === here || !isZone(event.zone)) return null;
  const start = fromHere(occurrence.start, event.zone, here);
  const end = fromHere(occurrence.end, event.zone, here);
  return `${timeSpan(event, start, end, prefs)} in ${zoneCity(event.zone)}`;
}

export function EventPopover({
  occurrence,
  calendar,
  anchor,
  area,
  prefs,
  onEdit,
  onDelete,
  onClose,
}: {
  occurrence: Occurrence;
  calendar: Calendar | undefined;
  anchor: Bounds;
  area: Bounds;
  prefs: ClockPrefs;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  const { event } = occurrence;
  const repeats = repeatSummary(event, prefs);
  const zone = zoneNote(occurrence, prefs);
  const lines = [zone, repeats, event.alert !== null ? `Alert: ${alertLabel(event.alert, event.allDay)}` : null, event.location || null].filter(
    (line): line is string => line !== null,
  );
  // Placed by its drawn height once it has one (an estimate first), so a short window never cuts its buttons.
  const [drawn, setDrawn] = useState<number | null>(null);
  const at = popoverOrigin(anchor, area, drawn ?? 146 + lines.length * 17);
  const line = (text: string, key: string) => (
    <Text key={key} numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
      {text}
    </Text>
  );
  return (
    <View
      testID="popover"
      onLayout={(bounds) => {
        if (Math.round(bounds.height) !== drawn) setDrawn(Math.round(bounds.height));
      }}
      occlude
      focusTrap
      accessibilityRole="dialog"
      style={{
        position: "absolute",
        left: at.x,
        top: at.y,
        width: POPOVER_WIDTH,
        flexDirection: "column",
        gap: 4,
        padding: 14,
        borderRadius: 12,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colors.separator,
        shadow: "xl",
        focusRingColor: colors.focusRing,
      }}
    >
      <View
        testID="popover:keys"
        onWindowKeyDown={(key) => {
          if (key.ctrl || key.alt || key.meta) return;
          if (key.key === "escape") onClose();
          else if (key.key === "enter") onEdit();
          else if (key.key === "backspace" || key.key === "delete") onDelete();
        }}
        style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}
      />
      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "semibold", color: colors.text }}>
        {titleOf(event)}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>
        {timeSpan(event, occurrence.start, occurrence.end, prefs)}
      </Text>
      {lines.map((each, index) => line(each, String(index)))}
      {calendar && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: calendar.color }} />
          <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
            {calendar.name}
          </Text>
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <Button label="Delete" testID="popover:delete" danger onPress={onDelete} />
        <View style={{ flex: 1 }} />
        <Button label="Edit…" testID="popover:edit" primary onPress={onEdit} />
      </View>
    </View>
  );
}
