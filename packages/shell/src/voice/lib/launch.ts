/**
 * Reaching dashi-voice. In a Dashi session the socket is there
 * (`dashi-voice.socket`) and the service starts on the first connection. From
 * a checkout (`DASHI_VOICE` names the built service, vm/dev-session) there is
 * no such unit, so the shell starts it once, as a unit of its own: never as
 * its child, or the microphone pill would take its `pw-record` for one of
 * Dashi's own helpers and stay dark while Dashi listens (docs/voice.md).
 */

import { connectVoice, type VoiceLink, voiceSocketPath } from "../client.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** The variables the service reads, passed on to its unit. */
const PASSED = ["DASHI_VOICE_MODELS", "DASHI_VOICE_SOCKET", "DASHI_VOICE_ONNXRUNTIME"] as const;

/** The command that starts the checkout's service as the user unit `dashi-voice`. */
export function serviceCommand(env: Env): string[] | null {
  const program = env.DASHI_VOICE;
  if (!program) return null;
  const passed = PASSED.flatMap((name) => (env[name] ? [`--setenv=${name}=${env[name]}`] : []));
  return ["systemd-run", "--user", "--collect", "--quiet", "--unit", "dashi-voice", ...passed, program, "serve"];
}

export interface Launch {
  env?: Env;
  connect?: (path: string | null) => Promise<VoiceLink | null>;
  run?: (command: string[]) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
}

const runCommand = async (command: string[]): Promise<void> => {
  await Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exited;
};

/** A connector for `VoiceService`: connects, and from a checkout starts the service first, once. */
export function voiceConnector({
  env = process.env,
  connect = connectVoice,
  run = runCommand,
  wait = (ms) => Bun.sleep(ms),
}: Launch = {}): () => Promise<VoiceLink | null> {
  let started = false;
  return async () => {
    const path = voiceSocketPath(env);
    const link = await connect(path);
    const command = serviceCommand(env);
    if (link || !command || started) return link;
    started = true;
    await run(command).catch(() => {});
    for (let tries = 0; tries < 20; tries++) {
      const next = await connect(path);
      if (next) return next;
      await wait(150);
    }
    return null;
  };
}
