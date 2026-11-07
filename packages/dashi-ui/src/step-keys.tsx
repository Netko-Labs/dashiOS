/**
 * The keyboard for a control that steps through values: a pop-up button's
 * options, a slider's notches (KB-1). Metal hands a focused view only Space
 * and Return; the arrows move inside a `focusGroup`. So the control lays a
 * group over itself, one focusable stop per value, with `selectsOnFocus`:
 * Tab reaches the stop of the value it shows, an arrow moves to the next
 * stop and presses it (the control takes that value), and Space or Return
 * press the stop it is on (the control's own action: a pop-up opens).
 *
 * Only the shown value's stop covers the control, so the ring goes round
 * the whole control and a click lands on it as on the control; the others
 * have no size. A value that changes some other way (the pointer, the
 * menu, the app) makes a new group, so Tab doesn't come back to a stop the
 * control has left.
 */

import { type Bounds, View } from "@mirinjs/metal";
import { useRef } from "react";

export interface StepKeysProps {
  /** One label per value, in order: what a screen reader reads for its stop. */
  labels: readonly string[];
  /** The shown value's place in `labels`; -1 when it is none of them. */
  index: number;
  /** An arrow reached the stop at `index`: take its value. */
  onStep: (index: number) => void;
  /** Space or Return (or a click) on the shown value's stop. */
  onActivate?: (bounds: Bounds | undefined) => void;
  /** The control's corner radius, for the ring. */
  radius: number;
  ringColor: string;
  testID: string;
}

const COVER = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;
const NONE = { position: "absolute", left: 0, top: 0, width: 0, height: 0 } as const;

export function StepKeys({ labels, index, onStep, onActivate, radius, ringColor, testID }: StepKeysProps) {
  const stepped = useRef(index);
  const shown = useRef(index);
  const group = useRef(0);
  if (index !== shown.current) {
    // Moved by something other than the arrows: Tab starts again at the shown value.
    if (index !== stepped.current) group.current += 1;
    shown.current = index;
    stepped.current = index;
  }
  // With no value shown, the first stop stands for the control.
  const cover = index < 0 ? 0 : index;
  return (
    <View key={group.current} testID={`${testID}:keys`} focusGroup selectsOnFocus accessibilityRole="listbox" style={{ ...COVER, focusRingColor: ringColor }}>
      {labels.map((label, at) => (
        <View
          // The values never reorder while the group lives.
          key={at}
          testID={`${testID}:key:${at}`}
          focusable
          accessibilityRole="option"
          accessibilityLabel={label}
          accessibilityState={{ selected: at === index }}
          onPress={(event) => {
            if (at === cover) {
              onActivate?.(event.bounds);
              return;
            }
            stepped.current = at;
            onStep(at);
          }}
          style={at === cover ? { ...COVER, borderRadius: radius } : NONE}
        />
      ))}
    </View>
  );
}
