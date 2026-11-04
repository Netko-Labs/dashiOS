/**
 * The screens, from dashi-comp's IPC ($DASHI_COMP_SOCKET, which the
 * compositor gives its session client): which there are, and which is the
 * main one (where the login form goes; the others show a backdrop). Follows
 * screens plugged in or out while the login screen shows. Each screen gets
 * the scale its density wants (`defaultScale`, as the desktop picks it), so a
 * HiDPI panel's login screen isn't tiny.
 */

import { defaultScale } from "@dashi/ui";

export interface Screen {
  name: string;
  primary: boolean;
}

/** The enabled screens in an `outputs` answer, malformed entries skipped. */
export function parseScreens(answer: unknown): Screen[] {
  const outputs = typeof answer === "object" && answer !== null ? (answer as { outputs?: unknown }).outputs : undefined;
  if (!Array.isArray(outputs)) return [];
  return outputs.flatMap((output: unknown): Screen[] => {
    if (typeof output !== "object" || output === null) return [];
    const { name, enabled, primary } = output as Record<string, unknown>;
    if (typeof name !== "string" || name === "" || name.length > 64 || enabled === false) return [];
    return [{ name, primary: primary === true }];
  });
}

/** The screens whose scale isn't the one their density wants: `{name, scale}` to ask for. */
export function scalesToSet(answer: unknown): { name: string; scale: number }[] {
  const outputs = typeof answer === "object" && answer !== null ? (answer as { outputs?: unknown }).outputs : undefined;
  if (!Array.isArray(outputs)) return [];
  const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return outputs.flatMap((output: unknown) => {
    if (typeof output !== "object" || output === null) return [];
    const { name, enabled, mode, physicalMm, scale, transform } = output as Record<string, unknown>;
    if (typeof name !== "string" || name === "" || name.length > 64 || enabled === false || typeof scale !== "number") return [];
    const pixels = (typeof mode === "object" && mode !== null ? mode : {}) as Record<string, unknown>;
    const size = (typeof physicalMm === "object" && physicalMm !== null ? physicalMm : {}) as Record<string, unknown>;
    const turn = typeof transform === "object" && transform !== null ? (transform as Record<string, unknown>).rotation : 0;
    const sideways = turn === 90 || turn === 270;
    const [width, height] = sideways ? [number(pixels.height), number(pixels.width)] : [number(pixels.width), number(pixels.height)];
    const [widthMm, heightMm] = sideways ? [number(size.height), number(size.width)] : [number(size.width), number(size.height)];
    const wanted = defaultScale({ name, width, height, widthMm, heightMm });
    return wanted === scale ? [] : [{ name, scale: wanted }];
  });
}

/** Where the login form goes: the main screen, else the first. */
export function mainScreen(screens: readonly Screen[]): string | undefined {
  return (screens.find((screen) => screen.primary) ?? screens[0])?.name;
}

/**
 * Calls `onScreens` with the screens now and whenever they change; resolves to
 * a stop function. Without the socket (an older compositor, a test) it never calls.
 */
export async function watchScreens(onScreens: (screens: Screen[]) => void, path = process.env.DASHI_COMP_SOCKET): Promise<() => void> {
  if (!path) return () => {};
  let buffered = "";
  let next = 1;
  const ask = (method: string, params: Record<string, unknown> = {}): string => `${JSON.stringify({ id: next++, method, params })}\n`;
  const socket = await Bun.connect({
    unix: path,
    socket: {
      data(socket, chunk) {
        buffered += chunk.toString();
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          let frame: unknown;
          try {
            frame = JSON.parse(line);
          } catch {
            continue;
          }
          if (typeof frame !== "object" || frame === null) continue;
          const { result, event } = frame as { result?: unknown; event?: unknown };
          if (event === "outputs-changed") socket.write(ask("outputs"));
          else if (result !== undefined && typeof result === "object" && result !== null && "outputs" in result) {
            // A new scale changes the outputs, and the screens are read again then.
            for (const change of scalesToSet(result)) socket.write(ask("output", change));
            onScreens(parseScreens(result));
          }
        }
      },
    },
  });
  socket.write(ask("subscribe") + ask("outputs"));
  return () => socket.end();
}
