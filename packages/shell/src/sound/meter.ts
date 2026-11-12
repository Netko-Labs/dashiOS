/**
 * A level meter: while something on screen shows it, `pw-record` listens
 * as raw 8 kHz mono samples and each block of them becomes one number from
 * 0 to 1. The samples are read for their loudness and dropped; nothing is
 * stored or sent anywhere, and the recorder is stopped when nothing shows
 * the meter. Without a target it listens to the default input (Settings'
 * microphone meter). With one (an object.serial) it listens to that node
 * alone: an app's stream, or the device an app records from
 * (stream-meters.ts). A targeted recorder never falls back to another node:
 * if its target is not there, or goes, it ends (`node.dont-fallback`,
 * `node.dont-reconnect`), so a meter for an app's sound can never end up
 * listening to the microphone. It is marked a monitor and kept out of
 * WirePlumber's memory. A development run gets a stand-in that moves by
 * itself, so it never listens to the host.
 */

/** 8 kHz, 16 bits, mono: 100 ms of sound is 1600 bytes. */
const BLOCK_BYTES = 1600;

/** The loudest sample of little-endian signed 16-bit PCM, 0 to 1. */
export function peakOf(bytes: Uint8Array): number {
  let peak = 0;
  for (let at = 0; at + 1 < bytes.length; at += 2) {
    const low = bytes[at] as number;
    const high = bytes[at + 1] as number;
    const sample = (high << 8) | low;
    const value = Math.abs(sample >= 0x8000 ? sample - 0x10000 : sample);
    if (value > peak) peak = value;
  }
  return Math.min(peak / 32768, 1);
}

/** A peak as a bar's length: loudness is felt on a log scale, so -50 dB is the bottom and full scale the top. */
export function meterLevel(peak: number): number {
  if (peak <= 0) return 0;
  const decibels = 20 * Math.log10(peak);
  return Math.min(Math.max((decibels + 50) / 50, 0), 1);
}

export interface LevelMeter {
  /** Starts listening; `onLevel` hears a number from 0 to 1 about ten times a second. Returns the stop function. */
  start(onLevel: (level: number) => void): () => void;
}

type Spawn = (command: string[]) => { stdout: ReadableStream<Uint8Array>; kill(): void };

const bunSpawn: Spawn = (command) => {
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  return { stdout: child.stdout, kill: () => child.kill() };
};

/** What a targeted recorder says of itself: it stays on its target or ends, it is a monitor (never an app's row), and WirePlumber keeps nothing of it. */
const TAP_PROPS = JSON.stringify({
  "node.name": "dashi-meter",
  "node.dont-fallback": true,
  "node.dont-reconnect": true,
  "stream.monitor": true,
  "state.restore-props": false,
  "state.restore-target": false,
});

/** The recorder's command: the default input, or the node whose object.serial is `target`. */
export function meterCommand(target?: number): string[] {
  const aim = target === undefined ? [] : ["--target", String(target), "-P", TAP_PROPS];
  return ["pw-record", ...aim, "--raw", "--rate", "8000", "--channels", "1", "--format", "s16", "--latency", "50ms", "-"];
}

export function pipewireMeter(spawn: Spawn = bunSpawn, target?: number): LevelMeter {
  return {
    start(onLevel) {
      let stopped = false;
      let child: ReturnType<Spawn> | null = null;
      if (target !== undefined && !(Number.isSafeInteger(target) && target >= 0)) return () => {};
      try {
        child = spawn(meterCommand(target));
      } catch {
        // No recorder: the meter stays empty.
        return () => {};
      }
      const source = child.stdout;
      void (async () => {
        let pending = new Uint8Array(0);
        try {
          for await (const chunk of source) {
            if (stopped) return;
            const joined = new Uint8Array(pending.length + chunk.length);
            joined.set(pending);
            joined.set(chunk, pending.length);
            let at = 0;
            for (; joined.length - at >= BLOCK_BYTES; at += BLOCK_BYTES) onLevel(meterLevel(peakOf(joined.subarray(at, at + BLOCK_BYTES))));
            pending = joined.slice(at);
          }
        } catch {
          // The recorder went away.
        }
      })();
      return () => {
        stopped = true;
        child?.kill();
      };
    },
  };
}

/** A level that rises and falls like speech, for a run that must not listen to the machine; `offset` sets several apart. */
export function fakeMeter(offset = 0): LevelMeter {
  return {
    start(onLevel) {
      let step = offset;
      const timer = setInterval(() => {
        step++;
        const syllable = Math.max(0, Math.sin(step / 3)) * 0.6 + Math.max(0, Math.sin(step / 1.3)) * 0.25;
        onLevel(Math.min(1, syllable));
      }, 100);
      return () => clearInterval(timer);
    },
  };
}
