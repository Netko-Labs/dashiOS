/**
 * A picture to pick (CO-9, SE-A19): a theme, a wallpaper, a display, an
 * accent's swatch, Your Dashi's mark. The chosen one is ringed 2.5 in the on
 * colour, the ring concentric with the picture (its radius the picture's,
 * plus the room and the ring); where the choices are colours themselves (the
 * swatches, Your Dashi's), the ring is ink, so it never competes with them.
 * Its caption, if any, sits under the ring, SemiBold while chosen. A Tab stop
 * with the option role; put the choices in one focus group (a listbox) so the arrows move
 * between them (KB-1).
 */

import { Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { Look } from "./button-measures.ts";
import { useControlColors } from "./panel/index.ts";
import { CLEAR, OPACITY, SPACE, TYPE, useColors, WEIGHT } from "./theme/index.ts";

/** The ring's width, the room between it and the picture, and the caption's gap. */
export const PICTURE_CHOICE = { ring: 2.5, room: SPACE.xxs, gap: SPACE.xs } as const;

/** The ring's outer radius for a picture of this radius with this room: concentric with it. */
export const pictureRingRadius = (radius: number, room: number = PICTURE_CHOICE.room): number => radius + room + PICTURE_CHOICE.ring;

export interface PictureChoiceProps {
  testID: string;
  /** What a screen reader says; the caption when there is one. */
  label: string;
  chosen: boolean;
  onPress: () => void;
  /** The picture's own corner radius (half its size for a round one). */
  radius: number;
  /** The room between the ring and the picture (a theme's card keeps 8). */
  room?: number;
  /** Ink where the choices are colours themselves; the on colour otherwise. */
  ring?: "on" | "ink";
  /** Words under the ring; `small` for a swatch's 11. */
  caption?: string;
  small?: boolean;
  /** The tile's width (the caption is cut to it); its content's otherwise. */
  width?: number;
  /** Stretch across its row (Appearance's themes share the hero). */
  grow?: boolean;
  disabled?: boolean;
  look?: Look;
  children: ReactNode;
}

export function PictureChoice({
  testID,
  label,
  chosen,
  onPress,
  radius,
  room = PICTURE_CHOICE.room,
  ring = "on",
  caption,
  small,
  width,
  grow,
  disabled,
  look = "panel",
  children,
}: PictureChoiceProps) {
  const colors = useColors();
  const panel = useControlColors();
  const on = look === "panel" ? panel.on : colors.selection;
  const ink = look === "panel" ? panel.text : colors.text;
  const muted = look === "panel" ? panel.muted : colors.textMuted;
  const outer = pictureRingRadius(radius, room);
  return (
    <View
      testID={testID}
      focusable={!disabled}
      accessibilityRole="option"
      accessibilityLabel={label}
      accessibilityState={{ selected: chosen, disabled: disabled === true }}
      onPress={disabled ? undefined : onPress}
      style={{
        ...(width !== undefined ? { width } : {}),
        ...(grow ? { flex: 1 } : {}),
        flexDirection: "column",
        alignItems: "center",
        gap: PICTURE_CHOICE.gap,
        borderRadius: outer,
        focusRingColor: colors.focusRing,
        ...(disabled ? { opacity: OPACITY.disabled } : {}),
      }}
    >
      <View
        testID={`${testID}:ring`}
        style={{
          ...(grow ? { alignSelf: "stretch" } : {}),
          padding: room,
          borderRadius: outer,
          borderWidth: PICTURE_CHOICE.ring,
          borderColor: chosen ? (ring === "ink" ? ink : on) : CLEAR,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </View>
      {caption !== undefined && (
        // A one-line caption is as wide as its slot, so it centres in the tile's width.
        <View style={{ alignSelf: "stretch", alignItems: "center" }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: small ? TYPE.caption.size : TYPE.secondary.size,
              fontWeight: chosen ? WEIGHT.semibold : WEIGHT.regular,
              color: chosen || !small ? ink : muted,
              textAlign: "center",
            }}
          >
            {caption}
          </Text>
        </View>
      )}
    </View>
  );
}
