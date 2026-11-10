/**
 * Screen recordings: where they go, what they are called, and the
 * wf-recorder command that makes one. wf-recorder copies the screen through
 * dashi-comp's wlr-screencopy (paced to the refresh; the shell allows it only
 * while it records, screen-capture.ts) and encodes with the system's FFmpeg
 * libraries. Codecs are tried in order (`CODECS`): H.264 in an MP4 where
 * FFmpeg has it (RPM Fusion's, Dashi's default), else VP9 in a WebM.
 */

import { join } from "node:path";
import type { RecordTarget } from "../types.ts";

export const WF_RECORDER = "/usr/bin/wf-recorder";

export interface Codec {
  /** FFmpeg's encoder name. */
  name: string;
  extension: "mp4" | "webm";
  /** wf-recorder `-p` codec options. */
  params: readonly string[];
}

/** Tried in order until one starts: software H.264 (fast preset, good quality), Cisco's OpenH264, then VP9. */
export const CODECS: readonly Codec[] = [
  { name: "libx264", extension: "mp4", params: ["preset=veryfast", "crf=20"] },
  { name: "libopenh264", extension: "mp4", params: [] },
  { name: "libvpx-vp9", extension: "webm", params: ["deadline=realtime", "cpu-used=8"] },
];

/** Frames per second recorded. */
export const FRAME_RATE = 30;

/** Where recordings go. HOME is read on each use, so a test can point it elsewhere. */
export function recordingDirectory(env: Record<string, string | undefined> = process.env): string {
  return join(env.HOME || "/", "Videos", "Screen Recordings");
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** "Screen Recording 2026-11-03 at 21.04.05.mp4", with " (2)" and on for one already `taken`. */
export function recordingName(when: Date, extension: string, taken: (name: string) => boolean): string {
  const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const time = `${pad(when.getHours())}.${pad(when.getMinutes())}.${pad(when.getSeconds())}`;
  const stem = `Screen Recording ${day} at ${time}`;
  const named = (copy: number): string => `${copy === 1 ? stem : `${stem} (${copy})`}.${extension}`;
  let copy = 1;
  while (taken(named(copy))) copy += 1;
  return named(copy);
}

export interface RecordOptions {
  target: RecordTarget;
  file: string;
  codec: Codec;
  /** Record the default microphone too (PipeWire). The pointer is always in the picture. */
  microphone: boolean;
}

/** wf-recorder's arguments for one recording. */
export function recorderArgs({ target, file, codec, microphone }: RecordOptions): string[] {
  const where =
    target.kind === "screen"
      ? ["-o", target.output]
      : ["-g", `${Math.round(target.x)},${Math.round(target.y)} ${Math.max(2, Math.round(target.width))}x${Math.max(2, Math.round(target.height))}`];
  return [
    ...where,
    "-f",
    file,
    "-c",
    codec.name,
    ...codec.params.flatMap((param) => ["-p", param]),
    "-r",
    String(FRAME_RATE),
    // Even sizes: H.264's 4:2:0 needs them, and an area or a scaled screen may not have them.
    "-F",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    // dashi-comp's screencopy fills shm buffers only.
    "--no-dmabuf",
    ...(microphone ? ["-a", "--audio-backend=pipewire"] : []),
    // Never ask on the terminal whether to overwrite: the name is new.
    "-y",
  ];
}
