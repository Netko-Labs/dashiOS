/**
 * Who signs in on the split screen (LK-1): the initials (52, Inter Display SemiBold) on regular glass or the
 * person's picture, the name over a 280 field of regular glass with its ink go arrow, the hint under them;
 * what the greeter puts above (Other users) and below (the session chip).
 */

import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { Frosted } from "./frosted.tsx";
import { CHEVRON_RIGHT } from "./glyphs.ts";
import { initialsOf } from "./login-split.tsx";
import { Picture } from "./picture.tsx";
import { CLEAR, type LoginColors } from "./theme/colors.ts";
import { GLASS } from "./theme/glass.ts";
import { pill, SPACE, TYPE, WEIGHT } from "./theme/measures.ts";

export interface WhoSignsInProps {
  name: string;
  picture?: string | undefined;
  display: boolean;
  colors: LoginColors;
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder: string;
  secure: boolean;
  hint: string;
  error: boolean;
  above?: ReactNode;
  below?: ReactNode;
}

/** Who signs in (LK-1): the initials (52) or picture, the name over the field, the hint under them. */
export function WhoSignsIn(props: WhoSignsInProps): ReactNode {
  const { name, picture, display, colors, hint, error, above, below } = props;
  const size = GLASS.lock.initials;
  const initials = (
    <Frosted level="regular" style={{ width: size, height: size, borderRadius: pill(size), alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: TYPE.title.size, fontWeight: WEIGHT.semibold, color: colors.ink, ...(display ? { fontFamily: "display" } : {}) }}>
        {initialsOf(name)}
      </Text>
    </Frosted>
  );
  return (
    <View testID="lock-who" style={{ flexDirection: "column", alignItems: "flex-start", gap: SPACE.gap }}>
      {above}
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.button }}>
        {picture ? (
          <Picture source={picture} resizeMode="cover" style={{ width: size, height: size, borderRadius: pill(size) }} fallback={initials} />
        ) : (
          initials
        )}
        <View style={{ flexDirection: "column", gap: SPACE.xs }}>
          <Text style={{ fontSize: TYPE.heading.size, fontWeight: WEIGHT.semibold, color: colors.ink }}>{name}</Text>
          <GlassField {...props} />
        </View>
      </View>
      <Text style={{ fontSize: TYPE.secondary.size, color: error ? colors.wrong : colors.muted }}>{hint}</Text>
      {below}
    </View>
  );
}

/** The field (LK-1): regular glass, a pill `GLASS.lock.field` wide, the go arrow an ink disc at its end. */
function GlassField({ value, onChangeText, onSubmit, placeholder, secure, colors }: WhoSignsInProps): ReactNode {
  const height = GLASS.lock.pill.height;
  const arrow = GLASS.lock.arrow;
  return (
    <Frosted level="regular" style={{ width: GLASS.lock.field, height, borderRadius: pill(height), flexDirection: "row", alignItems: "center" }}>
      <TextInput
        testID="login-field"
        value={value}
        autoFocus
        secureTextEntry={secure}
        placeholder={placeholder}
        accessibilityLabel={placeholder}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        style={{
          flex: 1,
          height,
          padding: SPACE.button,
          borderRadius: pill(height),
          backgroundColor: CLEAR,
          borderColor: CLEAR,
          focusBorderColor: colors.focusRing,
          fontSize: TYPE.body.size,
          color: colors.ink,
          placeholderColor: colors.muted,
        }}
      />
      <View
        testID="login-go"
        accessibilityRole="button"
        accessibilityLabel="Unlock"
        onPress={onSubmit}
        style={{
          position: "absolute",
          right: SPACE.xs,
          width: arrow,
          height: arrow,
          borderRadius: pill(arrow),
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.ink,
        }}
      >
        <Svg markup={CHEVRON_RIGHT} size={TYPE.caption.size} color={colors.onInk} />
      </View>
    </Frosted>
  );
}
