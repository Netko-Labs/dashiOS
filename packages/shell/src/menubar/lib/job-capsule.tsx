/**
 * A job's capsule in the menu bar (docs/design.html, "Jobs in the bar"; the
 * design's b-09 to b-21): a disc with a ring, and beside it, for the one
 * that speaks, its name and the words of its step. Purple is Dashi, clay
 * Claude Code, ink Codex; amber with an ink line is a job that needs the
 * person; a tick is a finished one. The pointer over a speaking capsule
 * turns its disc into a square: a click there stops that job.
 */

import { CHECK, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { discGlyph } from "../../agents/index.ts";
import { SPARK } from "../../shared/settings/index.ts";
import { type BarJob, CAPSULE, type CapsuleForm, type JobRow, jobLabel, MORE_JOBS_WIDTH } from "./bar-jobs.ts";

/** Amber, the colour of "needs you" (the design's #f0b93c), and the ink on it. */
export const NEED = { fill: "#F0B93C", ink: "#1D1D1F", glyph: "#86600A" } as const;
const CLAY = "#B4532F";
const INK = "#1D1D1F";
const PAPER = "#ECECEE";

/** A capsule's fill, the ink of its words, and its disc's glyph, by who it is and how it stands. */
export function capsuleLook(
  job: Pick<BarJob, "who" | "state">,
  colors: ReturnType<typeof useColors>,
  dashi: string,
): { fill: string; ink: string; glyph: string } {
  if (job.state === "need") return NEED;
  if (job.state === "off") return { fill: colors.button, ink: colors.textMuted, glyph: colors.textMuted };
  if (job.who === "claude-code") return { fill: CLAY, ink: "#ffffff", glyph: CLAY };
  // Codex is ink: it turns over in Dark, as dictation's capsule does.
  if (job.who === "codex")
    return colors.text.toLowerCase().startsWith("#1d1d1f") ? { fill: INK, ink: "#ffffff", glyph: INK } : { fill: PAPER, ink: INK, glyph: INK };
  return { fill: dashi, ink: "#ffffff", glyph: dashi };
}

const STEPS = 12;
const STEP_MS = 120;
/** A third of a circle, turning: the ring of a job at work. */
const arc = (turn: number): string => {
  const size = CAPSULE.ring;
  const r = (size - 2) / 2;
  const c = size / 2;
  const at = (degrees: number) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return `${(c + r * Math.cos(radians)).toFixed(2)} ${(c + r * Math.sin(radians)).toFixed(2)}`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><path d="M${at(turn)} A${r} ${r} 0 0 1 ${at(turn + 130)}" stroke="#000" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;
};
const RING = Array.from({ length: STEPS }, (_, step) => arc((360 / STEPS) * step));
const SQUARE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="2" fill="#000"/></svg>`;

/** The ring's arc, stepping round while the job works; still with Reduce Motion. */
function Turning({ color, reduceMotion }: { color: string; reduceMotion: () => boolean }) {
  const [step, setStep] = useState(0);
  const still = reduceMotion();
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => setStep((now) => (now + 1) % STEPS), STEP_MS);
    return () => clearInterval(timer);
  }, [still]);
  return (
    <View testID="job-ring" style={{ position: "absolute", left: 0, top: 0 }}>
      <Svg markup={RING[still ? 0 : step] ?? ""} size={CAPSULE.ring} color={color} />
    </View>
  );
}

/** The disc: the ring's track, the turning arc while it works, and the white disc with who it is (a tick when done, a square to stop). */
function JobDisc(props: { job: BarJob; look: ReturnType<typeof capsuleLook>; stop: boolean; glyph: string; reduceMotion: () => boolean }) {
  const { job, look, stop, glyph, reduceMotion } = props;
  const light = look.ink === "#ffffff";
  const done = job.state === "fin";
  return (
    <View
      style={{
        width: CAPSULE.ring,
        height: CAPSULE.ring,
        borderRadius: CAPSULE.ring / 2,
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        backgroundColor: done ? "#ffffff" : light ? "#ffffff59" : "#1d1d1f33",
      }}
    >
      {job.state === "run" && !stop && <Turning color={light ? "#ffffff" : INK} reduceMotion={reduceMotion} />}
      <View
        style={{
          width: CAPSULE.disc,
          height: CAPSULE.disc,
          borderRadius: CAPSULE.disc / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: done ? "#00000000" : "#ffffff",
        }}
      >
        <Svg
          markup={stop ? SQUARE : done ? CHECK : job.who === null ? glyph : discGlyph(job.who)}
          size={done ? 11 : stop ? 10 : CAPSULE.glyph + 2}
          color={job.state === "need" && !stop ? NEED.glyph : look.glyph}
        />
      </View>
    </View>
  );
}

export interface JobCapsuleProps {
  job: BarJob;
  form: CapsuleForm;
  /** Dashi's colour (the persona's). */
  dashi: string;
  /** Dashi's glyph (the persona's mark, as SVG); the spark unless set. */
  glyph?: string;
  /** A click: open what it is doing, or its question. */
  onOpen: (job: BarJob, right: number) => void;
  /** The square: stop it. Absent where it can only be stopped from its panel. */
  onStop?: (job: BarJob) => void;
  reduceMotion: () => boolean;
  accessible: boolean;
}

export function JobCapsule({ job, form, dashi, glyph = SPARK, onOpen, onStop, reduceMotion, accessible }: JobCapsuleProps) {
  const colors = useColors();
  const [hovered, setHovered] = useState(false);
  const look = capsuleLook(job, colors, dashi);
  const speaks = form !== "disc";
  // The square shows on a task's capsule with words, while it can still be stopped; an agent is stopped from its panel.
  const stop = hovered && speaks && onStop !== undefined && job.kind === "task" && (job.state === "run" || job.state === "need");
  // The words are cut to length as data (bar-jobs.ts): they are drawn whole, never squeezed.
  const words = { fontSize: CAPSULE.fontSize, color: look.ink, flexShrink: 0 } as const;
  const open = ({ bounds }: { bounds?: { x: number; width: number } }) => onOpen(job, bounds ? bounds.x + bounds.width : 0);
  return (
    <View
      testID={`job:${job.key}`}
      onHoverChange={(over) => setHovered(over)}
      {...(accessible ? { accessibilityRole: "button" as const, accessibilityLabel: jobLabel(job) } : {})}
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        height: CAPSULE.height,
        borderRadius: CAPSULE.height / 2,
        backgroundColor: look.fill,
        // A job that needs you wears an ink line: amber alone is not enough against a bright wallpaper.
        ...(job.state === "need" ? { borderWidth: 1.5, borderColor: NEED.ink } : {}),
      }}
    >
      <View
        testID={`job-disc:${job.key}`}
        onPress={stop ? () => onStop?.(job) : open}
        style={{ height: CAPSULE.height, paddingLeft: CAPSULE.left, paddingRight: speaks ? 0 : CAPSULE.left, justifyContent: "center" }}
      >
        <JobDisc job={job} look={look} stop={stop} glyph={glyph} reduceMotion={reduceMotion} />
      </View>
      {speaks && (
        <View
          testID={`job-words:${job.key}`}
          onPress={open}
          style={{
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            height: CAPSULE.height,
            paddingLeft: CAPSULE.gap,
            paddingRight: CAPSULE.right,
          }}
        >
          {stop ? (
            <Text style={{ ...words, fontWeight: "semibold" }}>{`Stop ${job.title}`}</Text>
          ) : (
            <>
              {form === "full" && <Text style={{ ...words, fontWeight: "semibold" }}>{job.title}</Text>}
              <Text style={{ ...words, ...(form === "full" ? { opacity: 0.9 } : { fontWeight: "semibold" }) }}>
                {form === "full" ? job.step : job.step.charAt(0).toUpperCase() + job.step.slice(1)}
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

/** "+N": the jobs the row had no room for. A click opens them all. */
function MoreJobs({ count, onPress }: { count: number; onPress: (right: number) => void }) {
  const colors = useColors();
  return (
    <View
      testID="jobs-more"
      onPress={({ bounds }) => onPress(bounds ? bounds.x + bounds.width : 0)}
      style={{
        flexShrink: 0,
        minWidth: MORE_JOBS_WIDTH,
        height: CAPSULE.height,
        borderRadius: CAPSULE.height / 2,
        paddingLeft: 7,
        paddingRight: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.button,
      }}
    >
      <Text style={{ fontSize: CAPSULE.fontSize, fontWeight: "semibold", color: colors.text }}>{`+${count}`}</Text>
    </View>
  );
}

/** The jobs' row: "+N", the discs, then the capsule that speaks, against the mark. */
export function JobsRow({ row, onMore, ...each }: { row: JobRow; onMore: (right: number) => void } & Omit<JobCapsuleProps, "job" | "form">) {
  return (
    <View testID="bar-jobs" style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: CAPSULE.between }}>
      {row.more > 0 && <MoreJobs count={row.more} onPress={onMore} />}
      {row.capsules.map(({ job, form }) => (
        <JobCapsule key={job.key} job={job} form={form} {...each} />
      ))}
    </View>
  );
}
