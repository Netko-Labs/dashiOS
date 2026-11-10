/**
 * The menu bar's one mark for every agent (docs/design.html, "The agent
 * mark"; docs/actions.md, "Agents from the launcher"), as data. Agents
 * started from the launcher (runs) and agents connected from outside (an
 * MCP client, Claude on a phone over SSH) become one list (`mergeAgents`),
 * the panel's rows and the mark's discs; `markState` says what the mark
 * draws: each agent's harness glyph on a disc, up to three, then "+N"; a
 * ring while one works; the red dot while one sees or records the screen or
 * uses its own pointer and keys; amber words, "Waiting for you", only while
 * one needs the person. Nothing here hides an agent: every connection is an
 * entry while it is connected, whatever its run did. Pure.
 */

import { elapsedText } from "../shared/time/elapsed.ts";
import { currentStep, harnessGlyph, isWorking, type RunView } from "./handoff/index.ts";
import type { AgentInfo, Watching } from "./presence.ts";

/** At most this many discs; the rest are "+N". */
export const MARK_DISCS = 3;

export type EntryPhase = "idle" | "working" | "waiting";

/** One agent, from the launcher or connected, as the mark and the panel see it. */
export interface AgentEntry {
  /** `run:<id>` or `agent:<connection id>`. */
  key: string;
  kind: "run" | "connection";
  /** Its harness's id (harness-icons.ts), or null for the agents' sparkle. */
  harness: string | null;
  name: string;
  /** What it does now, in a few words: "Cutting the demo video", "Connected". */
  doing: string;
  phase: EntryPhase;
  /** It sees or records the screen, or uses its own pointer or keys, now. */
  watching: Watching | null;
  /** Since when it has been doing so (ms); null when not, or not known. */
  watchingSince: number | null;
  /** When it started or connected, for the order. */
  since: number;
  run?: RunView;
  agent?: AgentInfo;
}

/** The harness a connection is, from its process's name or the name it claims; null when neither says. */
export function connectionHarness(name: string, claims: string | null | undefined): string | null {
  for (const said of [name, claims ?? ""]) {
    const words = said.toLowerCase();
    if (/\bcodex\b|codex[-_]/.test(words)) return "codex";
    if (/opencode/.test(words)) return "opencode";
    if (/^claude(?:[-_ ]?code)?$/.test(words.trim())) return "claude-code";
  }
  return null;
}

/** The strongest of two: a recording outranks seeing the screen, which outranks the pointer. */
const RANK: Readonly<Record<Watching, number>> = { recording: 3, screen: 2, pointer: 1 };
export function strongest(a: Watching | null, b: Watching | null | undefined): Watching | null {
  if (!b) return a;
  if (!a) return b;
  return RANK[b] > RANK[a] ? b : a;
}

const runDoing = (run: RunView): string =>
  run.question ? "Waiting for you" : (currentStep(run)?.words ?? (run.steps.length === 0 && run.phase === "starting" ? "Starting" : "Thinking"));

const QUIET = new Set(["Connected", "Idle"]);

function connectionEntry(agent: AgentInfo): AgentEntry {
  const phase: EntryPhase = agent.waiting ? "waiting" : QUIET.has(agent.status) ? "idle" : "working";
  return {
    key: `agent:${agent.id}`,
    kind: "connection",
    harness: agent.harness ?? null,
    name: agent.name,
    doing: agent.waiting ? "Waiting for you" : agent.status,
    phase,
    watching: agent.watching ?? null,
    watchingSince: agent.watching ? (agent.watchingSince ?? null) : null,
    since: agent.since ?? 0,
    agent,
  };
}

/**
 * Every agent, once: each working run with what its connections see, then
 * every connection that isn't a working run's. Waiting on the person first,
 * then working, then idle; newest first within each.
 */
export function mergeAgents(connections: readonly AgentInfo[], runs: readonly RunView[]): AgentEntry[] {
  const working = runs.filter(isWorking);
  const runIds = new Set(working.map((run) => run.id));
  const fromRuns = working.map((run): AgentEntry => {
    const own = connections.filter((agent) => agent.task === run.id);
    const watching = own.reduce<Watching | null>((most, agent) => strongest(most, agent.watching), null);
    // The earliest of its connections doing what it shows.
    const sinces = own.flatMap((agent) => (watching !== null && agent.watching === watching && agent.watchingSince !== undefined ? [agent.watchingSince] : []));
    // A run's own connection asking (a question routed to the sheets) waits on the person too.
    const waiting = run.question !== null || own.some((agent) => agent.waiting === true);
    return {
      key: `run:${run.id}`,
      kind: "run",
      harness: run.harness,
      name: run.harnessName,
      doing: waiting ? "Waiting for you" : runDoing(run),
      phase: waiting ? "waiting" : "working",
      watching,
      watchingSince: sinces.length > 0 ? Math.min(...sinces) : null,
      since: run.started,
      run,
    };
  });
  // A connection whose run ended (or that never had one) is still connected: it stays in sight.
  const fromConnections = connections.filter((agent) => agent.task === undefined || !runIds.has(agent.task)).map(connectionEntry);
  const order: Readonly<Record<EntryPhase, number>> = { waiting: 0, working: 1, idle: 2 };
  return [...fromRuns, ...fromConnections].sort((a, b) => order[a.phase] - order[b.phase] || b.since - a.since);
}

export type MarkState =
  | { kind: "none" }
  | {
      kind: "mark";
      /** The discs' harnesses, the lead first (null: the sparkle). */
      discs: ReadonlyArray<string | null>;
      /** Agents beyond the discs: "+N". */
      more: number;
      /** One works: the ring turns. */
      working: boolean;
      /** The red dot. */
      watching: boolean;
      tip: string;
      label: string;
    }
  | { kind: "ask"; harness: string | null; watching: boolean; tip: string; label: string };

const WATCH_WORDS: Readonly<Record<Watching, string>> = {
  recording: "Recording the screen",
  screen: "Seeing the screen",
  pointer: "Using its pointer",
};

/** The access an agent has now, as its row's chip says it: "Recording the screen", "Waiting for you", "Connected". */
export function accessWords(entry: Pick<AgentEntry, "watching" | "phase" | "kind">): string {
  if (entry.watching) return WATCH_WORDS[entry.watching];
  if (entry.phase === "waiting") return "Waiting for you";
  return entry.kind === "run" ? "Working" : "Connected";
}

/**
 * How long it has been recording or seeing the screen ("2:14"), for its
 * row's chip; null while it does neither (its pointer's clicks are moments)
 * or the time isn't known.
 */
export function watchTime(entry: Pick<AgentEntry, "watching" | "watchingSince">, now: number): string | null {
  if ((entry.watching !== "recording" && entry.watching !== "screen") || entry.watchingSince === null) return null;
  return elapsedText(now - entry.watchingSince);
}

/** "Claude Code · Cutting the demo video", and how many more. */
function tipOf(entries: readonly AgentEntry[]): string {
  const [lead, ...rest] = entries;
  if (!lead) return "";
  const head = `${lead.name} · ${lead.doing}`;
  return rest.length === 0 ? head : `${head}, and ${rest.length} more`;
}

/** What the screen reader hears: who, how many, and whether one watches. */
function labelOf(entries: readonly AgentEntry[], watching: boolean): string {
  const lead = entries[0];
  if (!lead) return "";
  const who = entries.length === 1 ? `Agent: ${lead.name}, ${lead.doing}` : `${entries.length} agents: ${lead.name}, ${lead.doing}`;
  return watching ? `${who}. An agent sees or records the screen` : who;
}

/**
 * What the mark draws for `entries` (mergeAgents' order). `agentRecording`:
 * the recorder runs for an agent, which shows as the red dot whoever's
 * connection is in the list.
 */
export function markState(entries: readonly AgentEntry[], agentRecording = false): MarkState {
  const lead = entries[0];
  if (!lead) return { kind: "none" };
  const watching = agentRecording || entries.some((entry) => entry.watching !== null);
  const tip = tipOf(entries);
  const label = labelOf(entries, watching);
  if (lead.phase === "waiting") return { kind: "ask", harness: lead.harness, watching, tip, label };
  return {
    kind: "mark",
    discs: entries.slice(0, MARK_DISCS).map((entry) => entry.harness),
    more: Math.max(0, entries.length - MARK_DISCS),
    working: entries.some((entry) => entry.phase === "working"),
    watching,
    tip,
    label,
  };
}

/** A disc's glyph markup. */
export const discGlyph = (harness: string | null): string => harnessGlyph(harness);

/** What a tool's call does that the red dot shows: records, sees the screen, or uses the agent's own pointer and keys. */
export function watchingOf(tool: string): Watching | null {
  switch (tool) {
    case "record_screen":
      return "recording";
    case "screenshot":
      return "screen";
    case "click":
    case "drag":
    case "scroll":
    case "type_text":
    case "press_keys":
      return "pointer";
    default:
      return null;
  }
}

/** The recorder as the bar needs it: idle, or who records (or saves) now. */
export type Recording = { kind: "idle" } | { kind: "recording" | "starting" | "saving"; by: "person" | "agent" };

/**
 * Whether the red timer pill shows (recorder/indicator.tsx): always for the
 * person's own recording, which a click stops; an agent's folds into the
 * mark's red dot, unless no mark is up to carry it (its agent already gone),
 * since a recording is never out of sight.
 */
export function recordingPill(recording: Recording, markShown: boolean): boolean {
  if (recording.kind === "idle" || recording.kind === "starting") return false;
  return recording.by === "person" || !markShown;
}

/** An agent's recording runs: the mark's red dot, whoever's connection is listed. */
export const agentRecording = (recording: Recording): boolean => recording.kind !== "idle" && recording.by === "agent";
