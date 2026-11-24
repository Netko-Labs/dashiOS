/**
 * A field that is its surface's own row (UI-9's bare look): the launcher's
 * field, where the panel is the field. No edge and no ground of its own: the
 * words at the size the surface asks (`TYPE.field`, 17, through `useType`
 * in the launcher), the placeholder muted, the caret in the words' ink. It
 * takes the keyboard as it comes; a change of `focusKey` takes it back
 * (after a form that had it goes). Named for screen readers by `label`,
 * else its placeholder; a host's own accessibility props pass through.
 */

import { TextInput } from "@mirinjs/metal";
import { useColors } from "./theme/index.ts";

export interface BareFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  testID: string;
  /** The words' size: the surface's (the launcher's field, 17 at the person's text size). */
  size: number;
  placeholder?: string;
  label?: string;
  /** The host's revision of `value`, when the host changed it (a completion). */
  revision?: number;
  secure?: boolean;
  onSubmit?: (text: string) => void;
  onKeyPress?: (key: "Escape" | "ArrowUp" | "ArrowDown") => void;
  /** Change it to take the keyboard back. */
  focusKey?: string | number;
  /** Accessibility props the host builds (a role and name for its tree). */
  access?: Record<string, unknown>;
}

export function BareField({
  value,
  onChangeText,
  testID,
  size,
  placeholder,
  label,
  revision,
  secure,
  onSubmit,
  onKeyPress,
  focusKey = 0,
  access,
}: BareFieldProps) {
  const colors = useColors();
  return (
    <TextInput
      key={String(focusKey)}
      testID={testID}
      value={value}
      {...(revision === undefined ? {} : { valueRevision: revision })}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...((label ?? placeholder) ? { accessibilityLabel: label ?? placeholder } : {})}
      {...(secure ? { secureTextEntry: true } : {})}
      autoFocus
      onChangeText={onChangeText}
      {...(onSubmit ? { onSubmitEditing: onSubmit } : {})}
      {...(onKeyPress ? { onKeyPress } : {})}
      {...(access ?? {})}
      style={{ flex: 1, fontSize: size, color: colors.text, placeholderColor: colors.textMuted }}
    />
  );
}
