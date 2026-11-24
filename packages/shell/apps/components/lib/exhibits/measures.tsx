/** The gallery's measures page: the theme's TYPE, SPACE, RADIUS, SHADOW and OPACITY (TK-1), as they draw. */

import { OPACITY, type Palette, RADIUS, SHADOW, SPACE, TYPE, type TypeRole } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { Caption, Exhibit, Inked, PageBody } from "../specimen.tsx";

const ROLES: ReadonlyArray<[string, TypeRole]> = [
  ["caption", TYPE.caption],
  ["secondary", TYPE.secondary],
  ["body", TYPE.body],
  ["heading", TYPE.heading],
  ["title", TYPE.title],
  ["panel.micro", TYPE.panel.micro],
  ["panel.detail", TYPE.panel.detail],
  ["panel.body", TYPE.panel.body],
  ["panel.name", TYPE.panel.name],
  ["panel.title", TYPE.panel.title],
];

function Swatch({ label, children }: { label: string; children: (colors: Palette) => ReactNode }) {
  return (
    <View style={{ width: 84, flexDirection: "column", alignItems: "center", gap: SPACE.xs }}>
      <Inked>{children}</Inked>
      <Caption>{label}</Caption>
    </View>
  );
}

export function MeasuresPage() {
  return (
    <PageBody>
      <Exhibit title="Type" note="TYPE's roles, the app row and the panel row (TY-1); text size scales them all through useType().">
        <Inked>
          {(colors) => (
            <View style={{ flexDirection: "column", gap: SPACE.xs }}>
              {ROLES.map(([name, role]) => (
                <Text
                  key={name}
                  style={{ fontSize: role.size, lineHeight: role.line, color: colors.text }}
                >{`TYPE.${name} · ${role.size} / ${role.line}`}</Text>
              ))}
            </View>
          )}
        </Inked>
      </Exhibit>
      <Exhibit title="Space" note="SPACE's steps (TK-1).">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.m, alignItems: "flex-end" }}>
          {Object.entries(SPACE).map(([name, value]) => (
            <Swatch key={name} label={`${name} ${value}`}>
              {(colors) => <View style={{ width: value, height: SPACE.xl, backgroundColor: colors.text }} />}
            </Swatch>
          ))}
        </View>
      </Exhibit>
      <Exhibit title="Radii" note="RA-1's nest and the named surfaces.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.m }}>
          {Object.entries(RADIUS).map(([name, value]) => (
            <Swatch key={name} label={`${name} ${value}`}>
              {(colors) => <View style={{ width: 56, height: 56, borderRadius: value, borderWidth: 1, borderColor: colors.controlEdge }} />}
            </Swatch>
          ))}
        </View>
      </Exhibit>
      <Exhibit title="Shadows and opacity" note="DE-1's three shadows; OPACITY's five jobs.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.page }}>
          {Object.values(SHADOW).map((shadow) => (
            <Swatch key={shadow} label={`shadow ${shadow}`}>
              {(colors) => <View style={{ width: 56, height: 40, borderRadius: RADIUS.card, backgroundColor: colors.menu, shadow }} />}
            </Swatch>
          ))}
          {Object.entries(OPACITY).map(([name, value]) => (
            <Swatch key={name} label={`${name} ${value}`}>
              {(colors) => <View style={{ width: 40, height: 40, borderRadius: RADIUS.control, backgroundColor: colors.text, opacity: value }} />}
            </Swatch>
          ))}
        </View>
      </Exhibit>
    </PageBody>
  );
}
