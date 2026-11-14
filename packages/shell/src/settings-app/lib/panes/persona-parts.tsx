/**
 * The pieces of Settings › Your Dashi (persona.tsx): the capsule as it will look, saying the
 * preview's line; the six swatches; and a one-line field that keeps what was typed on Return.
 */

import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useEffect, useState, useSyncExternalStore } from "react";
import { COLOURS, type Colour, type ColourId, type PersonaSource } from "../../../persona/index.ts";
import { Group, Note, useSurface } from "../../../shared/cards/index.ts";
import type { PersonaMark } from "../../../shared/pill/index.ts";
import { SPARK } from "../../../shared/settings/index.ts";
import { useColors } from "../../colors.ts";

/** The capsule's measures (dashi-0.9.0-design/round3/pill-v2): 31 points tall, a white disc at its left, a light line round the fill. */
export const CAPSULE = { height: 31, disc: 21, dot: 4, line: "#ffffff59" } as const;

/** The mark in the white disc: the spark, or five dots in a line. */
function Mark({ mark, colour }: { mark: PersonaMark; colour: string }) {
  if (mark === "spark") return <Svg markup={SPARK} size={13} color={colour} />;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 1.5 }}>
      {[0, 1, 2, 3, 4].map((dot) => (
        <View key={dot} style={{ width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: colour }} />
      ))}
    </View>
  );
}

/** Dashi's capsule at true size, in the chosen colour, with the chosen mark, saying `line`. The white line and the sizes are not the person's to change. */
export function CapsulePreview({ colour, mark, line }: { colour: Colour; mark: PersonaMark; line: string }) {
  return (
    <View
      testID="persona-capsule"
      accessibilityLabel={`Dashi's capsule, ${colour.name}: ${line}`}
      style={{
        flexShrink: 1,
        minWidth: 0,
        height: CAPSULE.height,
        borderRadius: CAPSULE.height / 2,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 5,
        paddingRight: 14,
        backgroundColor: colour.to,
        borderWidth: 1,
        borderColor: CAPSULE.line,
      }}
    >
      <View
        style={{
          width: CAPSULE.disc,
          height: CAPSULE.disc,
          borderRadius: CAPSULE.disc / 2,
          backgroundColor: "#ffffff",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Mark mark={mark} colour={colour.deep} />
      </View>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "medium", color: "#ffffff" }}>
          {line}
        </Text>
      </View>
    </View>
  );
}

const SWATCH = 26;

/** Six round swatches; the chosen one wears a ring in the text's colour. */
export function Swatches({ value, onChange }: { value: ColourId; onChange: (colour: Colour) => void }) {
  const colors = useColors();
  return (
    <View testID="persona-colours" style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {COLOURS.map((colour) => {
        const chosen = colour.id === value;
        return (
          <View
            key={colour.id}
            testID={`persona-colour:${colour.id}`}
            focusable
            accessibilityRole="button"
            accessibilityLabel={colour.name}
            accessibilityState={{ selected: chosen }}
            onPress={() => onChange(colour)}
            style={{
              width: SWATCH + 8,
              height: SWATCH + 8,
              borderRadius: (SWATCH + 8) / 2,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 2,
              borderColor: chosen ? colors.text : "#00000000",
            }}
          >
            <View style={{ width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, backgroundColor: colour.to }} />
          </View>
        );
      })}
    </View>
  );
}

/**
 * One line of the person's own words. What is typed is kept on Return, never at each key, so the
 * file and the change log get one change; `check` says why a text is not kept (the name rule).
 */
export function LineField({
  testID,
  value,
  placeholder,
  max,
  width = 220,
  onKeep,
  onDraft,
}: {
  testID: string;
  value: string;
  placeholder: string;
  max: number;
  width?: number | "100%";
  /** Return was pressed with `text` in the field. */
  onKeep: (text: string) => void;
  /** What is in the field now, for the row's quiet line. */
  onDraft?: (text: string) => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  const [draft, setDraft] = useState(value);
  // The file changed under it (Undo, a character chosen): the field follows.
  useEffect(() => setDraft(value), [value]);
  return (
    <View style={{ width }}>
      <TextInput
        testID={testID}
        value={draft}
        placeholder={placeholder}
        onChangeText={(text) => {
          const next = [...text.replace(/[\n\r]/g, " ")].slice(0, max).join("");
          setDraft(next);
          onDraft?.(next);
        }}
        onSubmitEditing={(text) => onKeep([...text].slice(0, max).join(""))}
        style={{ width: "100%", fontSize: 13, padding: 7, borderRadius: 7, color: colors.text, backgroundColor: surface.field }}
      />
    </View>
  );
}

/** What a person's own character tells the assistant, in full, and the files that are not characters. */
export function CharacterFilesNotes({ source }: { source: PersonaSource }) {
  const view = useSyncExternalStore(source.subscribe, source.view);
  const refused = source.files().refused;
  return (
    <>
      {view.character.own && view.missing === null && (
        <Group testID="persona-told">
          <Note testID="persona-told-text">{`This is what your agent will be told: ${view.character.prompt[source.language()]}`}</Note>
        </Group>
      )}
      {refused.length > 0 && (
        <Group testID="persona-refused">
          {refused.slice(0, 4).map((each) => (
            <Note key={each.file} testID={`persona-refused:${each.file}`}>{`${each.file}: This file is not a character: ${each.why}.`}</Note>
          ))}
        </Group>
      )}
    </>
  );
}
