/**
 * The microphone's level meter: while the pane's input section is on screen,
 * `pw-record` listens to the default input as raw 8 kHz mono samples and
 * each block of them becomes one number from 0 to 1. The samples are read for
 * their loudness and dropped; nothing is stored or sent anywhere, and the
 * recorder is stopped when the pane closes. A development run gets a stand-in
 * that moves by itself, so it never listens to the host's microphone.
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

export function pipewireMeter(spawn: Spawn = bunSpawn): LevelMeter {
  return {
    start(onLevel) {
      let stopped = false;
      let child: ReturnType<Spawn> | null = null;
      try {
        child = spawn(["pw-record", "--raw", "--rate", "8000", "--channels", "1", "--format", "s16", "--latency", "50ms", "-"]);
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

/** A level that rises and falls like speech, for a run that must not listen to the machine's microphone. */
export function fakeMeter(): LevelMeter {
  return {
    start(onLevel) {
      let step = 0;
      const timer = setInterval(() => {
        step++;
        const syllable = Math.max(0, Math.sin(step / 3)) * 0.6 + Math.max(0, Math.sin(step / 1.3)) * 0.25;
        onLevel(Math.min(1, syllable));
      }, 100);
      return () => clearInterval(timer);
    },
  };
}
