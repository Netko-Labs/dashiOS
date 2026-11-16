/**
 * The model's server as a unit of the person's session (docs/dictation-rewrite.md,
 * "The server"): llama.cpp's `llama-server` (MIT), a separate program, started
 * with `systemd-run` when dictation is first used and stopped after idle. It
 * listens on a Unix socket in the runtime directory and may use no network.
 */

import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MODEL } from "./model.ts";

type Env = Readonly<Record<string, string | undefined>>;

export const UNIT = "dashi-rewrite";
/** Where the package puts llama-server (spin/rpm/dashi-llama.spec). */
export const PACKAGED_SERVER = "/usr/libexec/dashi/llama/llama-server";

/** The server program: the one `DASHI_REWRITE_SERVER` names (a checkout), else the packaged one; null when neither is there. */
export function serverProgram(env: Env = process.env, exists: (path: string) => boolean = existsSync): string | null {
  const program = env.DASHI_REWRITE_SERVER || PACKAGED_SERVER;
  return exists(program) ? program : null;
}

export function rewriteSocket(env: Env = process.env): string | null {
  if (env.DASHI_REWRITE_SOCKET) return env.DASHI_REWRITE_SOCKET;
  return env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, "dashi-rewrite.sock") : null;
}

/** Where the model's file is kept: beside the speech models, in the set dashi-voice fetches (docs/voice.md, "The models"). */
export function modelPath(env: Env = process.env): string {
  const folder = env.DASHI_VOICE_MODELS || join(env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share"), "dashi", "voice");
  return join(folder, MODEL.set, MODEL.file);
}

/** Half the threads, eight at most: the person is using the machine. */
export const threads = (cores: number = navigator.hardwareConcurrency): number => Math.max(2, Math.min(8, Math.floor(cores / 2)));

/** Where the model runs: the processor (the default, decisions.md D170), or a graphics card that is not NVIDIA's. */
export type Device = "cpu" | "gpu";

/** `DASHI_REWRITE_DEVICE=gpu` tries the integrated graphics card; anything else is the processor. */
export const deviceOf = (env: Env = process.env): Device => (env.DASHI_REWRITE_DEVICE === "gpu" ? "gpu" : "cpu");

/**
 * The command that starts the server as the user unit `dashi-rewrite`.
 * - No network: Unix sockets only. No core dumps: they would hold what was said.
 * - Its log goes nowhere, unless `DASHI_REWRITE_LOG=1` keeps it in the journal (a checkout, to see why it failed).
 * - On the processor by default: the model is small enough, and the desktop is drawn by the
 *   integrated graphics card. Asked for a graphics card, the NVIDIA one is still never woken for
 *   this, and Mesa's software Vulkan is not a graphics card.
 */
export function serverCommand(program: string, model: string, socket: string, cores?: number, device: Device = "cpu", log = false): string[] {
  const properties = [
    "PartOf=dashi-session.target",
    "NoNewPrivileges=yes",
    "RestrictAddressFamilies=AF_UNIX",
    "LimitCORE=0",
    "UMask=0077",
    "Nice=5",
    "LockPersonality=yes",
    "RestrictRealtime=yes",
    "RestrictSUIDSGID=yes",
    "SystemCallArchitectures=native",
    // The server's log names no word that was said, but it says when and how much: none of it is kept.
    ...(log ? [] : ["StandardOutput=null", "StandardError=null"]),
  ].flatMap((property) => ["-p", property]);
  const offload = device === "gpu" ? ["-ngl", "99"] : ["-ngl", "0", "--device", "none"];
  const server = [program, "-m", model, "--host", socket, ...offload, "-c", "4096", "-np", "1", "-t", String(threads(cores))];
  return [
    "systemd-run",
    "--user",
    "--collect",
    "--quiet",
    "--unit",
    UNIT,
    ...properties,
    "--setenv=VK_LOADER_DRIVERS_DISABLE=*nvidia*,*lvp*",
    ...server,
    "--no-webui",
    "-rea",
    "off",
    "--no-warmup",
  ];
}

export interface RewriteService {
  /** The socket the server listens on. */
  readonly socket: string;
  /** Starts the unit; false when it could not be asked. Started already is fine. */
  start(): Promise<boolean>;
  stop(): Promise<void>;
}

async function run(command: string[]): Promise<boolean> {
  try {
    return (await Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exited) === 0;
  } catch {
    return false;
  }
}

/** The real service, or null when this session has no runtime directory or no server program. */
export function unitService(env: Env = process.env): RewriteService | null {
  const socket = rewriteSocket(env);
  const program = serverProgram(env);
  if (!socket || !program) return null;
  return {
    socket,
    // A unit left from before (a shell that crashed) still serves: starting it again fails and that is fine.
    start: async () => {
      // Asked only when nothing answers on the socket: one that is there was left by a server that was stopped.
      if (!(await run(["systemctl", "--user", "--quiet", "is-active", `${UNIT}.service`]))) rmSync(socket, { force: true });
      return (await run(serverCommand(program, modelPath(env), socket, undefined, deviceOf(env), env.DASHI_REWRITE_LOG === "1"))) || existsSync(socket);
    },
    stop: async () => {
      await run(["systemctl", "--user", "stop", `${UNIT}.service`]);
      // The server does not take its socket with it.
      rmSync(socket, { force: true });
    },
  };
}
