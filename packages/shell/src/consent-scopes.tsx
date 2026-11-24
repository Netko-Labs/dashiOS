/** The consent sheet's permissions (consent.tsx): what this call needs, in full, and the rest as a grid of one-line check boxes (UI-10). */

import { CHECKBOX, Checkbox, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { Ask } from "./agents/index.ts";

interface ScopesProps {
  scopes: Ask["scopes"];
  /** The ids ticked. */
  checked: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

/** What this call needs: each with its words, first, so it is never out of sight. */
export function NeededScopes({ scopes, checked, onToggle }: ScopesProps) {
  const colors = useColors();
  return (
    <>
      {scopes.map((scope, index) => (
        <View
          key={scope.id}
          style={{
            flexDirection: "column",
            paddingTop: SPACE.xs,
            paddingBottom: SPACE.s,
            borderTopWidth: index === 0 ? 0 : 1,
            borderColor: colors.separator,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
            <Checkbox testID={`consent-scope:${scope.id}`} label={scope.label} checked={checked.has(scope.id)} onChange={() => onToggle(scope.id)} />
            <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.agentInk }}>needed now</Text>
          </View>
          {/* Under the words, clear of the box. */}
          <View style={{ paddingLeft: CHECKBOX.box + CHECKBOX.gap }}>
            <Text style={{ fontSize: TYPE.secondary.size, lineHeight: TYPE.secondary.line, color: colors.textMuted }}>{scope.detail}</Text>
          </View>
        </View>
      ))}
    </>
  );
}

/** Permissions as one line each, two to a row; pointing at one says what it allows. */
export function ScopeGrid({ scopes, checked, onToggle, onPoint, testID }: ScopesProps & { onPoint: (id: string, hovered: boolean) => void; testID: string }) {
  return (
    <View testID={testID} style={{ display: "grid", gridTemplateColumns: ["1fr", "1fr"], columnGap: SPACE.inset, flexShrink: 0 }}>
      {scopes.map((scope) => (
        <View
          key={scope.id}
          testID={`consent-scope:${scope.id}:cell`}
          style={{ minWidth: 0, overflow: "hidden" }}
          onHoverChange={(hovered) => onPoint(scope.id, hovered)}
        >
          <Checkbox testID={`consent-scope:${scope.id}`} label={scope.label} checked={checked.has(scope.id)} onChange={() => onToggle(scope.id)} />
        </View>
      ))}
    </View>
  );
}
