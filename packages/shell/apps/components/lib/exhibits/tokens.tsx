/**
 * The gallery's token pages: every color of the palette, the grounds, the
 * tints, and the type, each drawn from @dashi/ui's own values in the mode of
 * its column, with its name and its value.
 */

import { contrastRatio, type Palette, type Surface, TEXT_SIZES, TINT_ORDER, TINTS, useColors, useSurface } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { Exhibit, Inked, PageBody } from "../specimen.tsx";

/** A chip of `color` on the card, its name, its value, and (for an ink) its contrast on the window. */
function Swatch({ name, color, ratio }: { name: string; color: string; ratio?: number }) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 26 }}>
      <View
        style={{ width: 22, height: 22, borderRadius: 5, backgroundColor: surface.card, borderWidth: 1, borderColor: colors.separator, overflow: "hidden" }}
      >
        <View style={{ flex: 1, backgroundColor: color }} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>
          {name}
        </Text>
      </View>
      {ratio !== undefined && <Text style={{ fontSize: 11, color: colors.textMuted }}>{`${ratio.toFixed(2)}:1`}</Text>}
      <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: "monospace" }}>{color}</Text>
    </View>
  );
}

/** The inks text is drawn in: their contrast on the window is worth showing beside them. */
const INKS: ReadonlySet<keyof Palette> = new Set(["text", "textMuted", "textDisabled", "ume", "broth", "moss", "criticalInk", "agentInk", "onSelection"]);

function PaletteSwatches() {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View style={{ flexDirection: "column", gap: 2 }}>
      {(Object.keys(colors) as Array<keyof Palette>).map((name) => (
        <Swatch key={name} name={name} color={colors[name]} {...(INKS.has(name) ? { ratio: contrastRatio(colors[name], surface.window) } : {})} />
      ))}
    </View>
  );
}

export function ColorsPage() {
  return (
    <PageBody>
      <Exhibit title="Palette" note="Every color Dashi paints with (theme/palette.ts); an ink shows its contrast on the window.">
        <PaletteSwatches />
      </Exhibit>
    </PageBody>
  );
}

function SurfaceSwatches() {
  const surface = useSurface();
  return (
    <View style={{ flexDirection: "column", gap: 2 }}>
      {(Object.keys(surface) as Array<keyof Surface>).map((name) => (
        <Swatch key={name} name={name} color={surface[name]} />
      ))}
    </View>
  );
}

export function GroundsPage() {
  return (
    <PageBody>
      <Exhibit title="Grounds" note="The solid grounds a window paints on (theme/surface.ts): the window, its sidebar, a card, a field, a table's stripe.">
        <SurfaceSwatches />
      </Exhibit>
    </PageBody>
  );
}

export function TintsPage() {
  return (
    <PageBody>
      <Exhibit title="Tints" note="Color that only tells things apart, never a job color, in the order a list takes them. White reads on every one.">
        <Inked>
          {(colors) => (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {TINT_ORDER.map((name) => (
                <View key={name} style={{ width: 72, flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: TINTS[name] }}>
                    <Text style={{ fontSize: 15, fontWeight: "bold", color: "#ffffff" }}>{name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: colors.text }}>{name}</Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: "monospace" }}>{TINTS[name]}</Text>
                </View>
              ))}
            </View>
          )}
        </Inked>
      </Exhibit>
    </PageBody>
  );
}

/** The type scale (docs/design.html, Type): each size with its job. */
const SCALE: ReadonlyArray<{ size: number; weight: "normal" | "semibold" | "bold"; job: string }> = [
  { size: 20, weight: "bold", job: "A page title" },
  { size: 15, weight: "semibold", job: "An empty state's title" },
  { size: 13, weight: "bold", job: "A window's title, a sheet's question" },
  { size: 13, weight: "normal", job: "Body text and labels" },
  { size: 12, weight: "normal", job: "Secondary words, a message" },
  { size: 11, weight: "semibold", job: "A section heading" },
  { size: 11, weight: "normal", job: "A caption, a detail" },
];

export function TypePage() {
  return (
    <PageBody>
      <Exhibit title="Type scale" note="Weights are 400, 600 and 700 only, and no size is fractional.">
        <Inked>
          {(colors) =>
            SCALE.map((step) => (
              <View key={`${step.size}:${step.weight}`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 70, flexShrink: 0 }}>
                  <Text
                    style={{ fontSize: 11, color: colors.textMuted }}
                  >{`${step.size} ${step.weight === "normal" ? "Regular" : step.weight === "bold" ? "Bold" : "SemiBold"}`}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: step.size, fontWeight: step.weight, color: colors.text }}>
                    {step.job}
                  </Text>
                </View>
              </View>
            ))
          }
        </Inked>
      </Exhibit>
      <Exhibit title="Text size" note="Settings › Appearance › Text size multiplies every size by one of these.">
        <Inked>
          {(colors) => <Text style={{ fontSize: 12, color: colors.text }}>{TEXT_SIZES.map((size) => `${Math.round(size * 100)}%`).join(" · ")}</Text>}
        </Inked>
      </Exhibit>
    </PageBody>
  );
}
