/**
 * What leads Dashi's capsule: its disc with the persona's mark, then its five dots, which are its
 * face (docs/design.html, "Its face"). The dots keep the persona's shape at rest, move the
 * character's way while it thinks and speaks, and are the level's bars while it listens. A persona
 * whose mark is `dots` has no disc. Dictation's capsule never comes here: it stays ink, five plain dots.
 */

import { FaceDots } from "../../shared/face/index.ts";
import type { Cell, PersonaMark } from "../../shared/pill/index.ts";
import { useFace } from "./face-scope.tsx";
import { CAPSULE, type CapsuleColours } from "./measures.ts";
import { Disc, Dots } from "./parts.tsx";

type Level = Pick<Cell<number>, "subscribe" | "getSnapshot">;

export interface FaceLeadProps {
  colours: CapsuleColours;
  mark: PersonaMark;
  /** Given while listening: the level the dots follow, null for Reduce Motion. */
  listening?: Level | null;
}

export function FaceLead({ colours, mark, listening }: FaceLeadProps) {
  const face = useFace();
  if (!face) {
    // No scope: a line drawn alone, as before the face.
    if (mark === "dots") return <Dots level={listening ?? null} color={colours.text} />;
    return (
      <>
        <Disc colours={colours} />
        {listening !== undefined && <Dots level={listening} color={colours.text} />}
      </>
    );
  }
  const disc = mark !== "dots";
  // Beside the Dock there is no room for a face next to buttons: the disc stands alone there.
  const dots = !disc || !(face.compact && (face.mood === "think" || face.mood === "speak"));
  return (
    <>
      {disc && <Disc colours={colours} />}
      {dots && (
        <FaceDots
          testID="capsule-face"
          dots={face.persona.dots}
          motion={face.persona.motion}
          mood={face.mood}
          color={colours.text}
          still={face.still}
          level={face.level}
          gap={CAPSULE.dotGap}
          {...(face.word === undefined ? {} : { word: face.word })}
        />
      )}
    </>
  );
}
