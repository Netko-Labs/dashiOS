/**
 * The login screen's own controls, in its look (LOGIN's washes on the
 * darkened wallpaper): a person's picture, the way back to everyone
 * ("Other users", a drawn chevron: CP-4), the session as a chip, and one
 * person to pick. The greeter puts them round @dashi/ui's LoginScreen; each
 * is a control, so it lives in the kit (H22, UI-1).
 */

import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { CHEVRON_LEFT } from "./glyphs.ts";
import { Picture } from "./picture.tsx";
import { LOGIN, type LoginColors } from "./theme/colors.ts";
import { pill, RADIUS, SPACE, TYPE, WEIGHT } from "./theme/measures.ts";

/**
 * The parts' measures: the picture of the one signing in, and of each person
 * to pick; the chevron; a person's column on the picker, the picker's row
 * kept off the bottom and the room between people; the session chip's height.
 */
export const LOGIN_PARTS = { avatar: 64, pickAvatar: 72, pickWidth: 110, pickerBottom: 140, pickerGap: 32, chevron: 12, chip: 22 } as const;

/** A person's picture in a circle, or their initial: with no picture, or one the host cannot draw. */
export function Avatar({
  name,
  picture,
  size = LOGIN_PARTS.avatar,
  colors = LOGIN,
}: {
  name: string;
  picture?: string;
  size?: number;
  colors?: LoginColors;
}): ReactNode {
  const initial = (
    <View
      style={{ width: size, height: size, borderRadius: pill(size), backgroundColor: colors.initialsGround, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ fontSize: TYPE.figure.size, fontWeight: WEIGHT.semibold, color: colors.ink }}>{(name[0] ?? "?").toUpperCase()}</Text>
    </View>
  );
  if (!picture) return initial;
  return <Picture source={picture} resizeMode="cover" style={{ width: size, height: size, borderRadius: pill(size) }} fallback={initial} />;
}

/** "‹ Other users": back to choosing who, over the name. */
export function LoginBackLink({
  label,
  onPress,
  testID,
  colors = LOGIN,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  colors?: LoginColors;
}): ReactNode {
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xxs, marginBottom: SPACE.s, paddingHorizontal: SPACE.s, borderRadius: RADIUS.row }}
    >
      <Svg markup={CHEVRON_LEFT} size={LOGIN_PARTS.chevron} color={colors.muted} />
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.muted }}>{label}</Text>
    </View>
  );
}

/** The session to start, as a chip that steps to the next on a press. */
export function LoginChip({
  label,
  accessibilityLabel,
  onPress,
  testID,
  colors = LOGIN,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  testID: string;
  colors?: LoginColors;
}): ReactNode {
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={{
        height: LOGIN_PARTS.chip,
        marginTop: SPACE.xs,
        paddingHorizontal: SPACE.gap,
        justifyContent: "center",
        borderRadius: pill(LOGIN_PARTS.chip),
        backgroundColor: colors.chip,
      }}
    >
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.muted }}>{label}</Text>
    </View>
  );
}

/** One person on the picker: their picture over their name. */
export function LoginPerson({
  name,
  picture,
  onPress,
  testID,
  colors = LOGIN,
}: {
  name: string;
  picture?: string;
  onPress: () => void;
  testID: string;
  colors?: LoginColors;
}): ReactNode {
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onPress}
      style={{
        flexDirection: "column",
        alignItems: "center",
        gap: SPACE.gap,
        width: LOGIN_PARTS.pickWidth,
        paddingVertical: SPACE.s,
        borderRadius: RADIUS.sheet,
      }}
    >
      <Avatar name={name} picture={picture} size={LOGIN_PARTS.pickAvatar} colors={colors} />
      <Text style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.ink }}>{name}</Text>
    </View>
  );
}
