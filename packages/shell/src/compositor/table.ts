/**
 * Every IPC method once, on the shell's side: who may ask it, the shape of
 * its params and of its reply (docs/compositor-ipc.md; the compositor's own
 * table is crates/dashi-comp/src/ipc/table.rs, and test/compositor-contract
 * checks that the three name the same set, H9).
 */

import { AGENTS } from "./methods/agents.ts";
import { CHROME } from "./methods/chrome.ts";
import { SCREENS } from "./methods/screens.ts";
import { SPACES } from "./methods/spaces.ts";
import type { ParamsOf, ReplyOf } from "./methods/spec.ts";
import { WINDOWS } from "./methods/windows.ts";

export const METHODS = { ...WINDOWS, ...SCREENS, ...CHROME, ...SPACES, ...AGENTS };

export type Methods = typeof METHODS;
export type MethodName = keyof Methods;

/** `send-keys` → `sendKeys`. */
export type Camel<S extends string> = S extends `${infer Head}-${infer Tail}` ? `${Head}${Capitalize<Camel<Tail>>}` : S;

export const camel = (name: string): string => name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** Params a method takes: none, some optional, or some required. */
type Args<P> = Record<string, never> extends P ? [params?: P] : [params: P];

/** One typed method per IPC method, named in camelCase. */
export type Calls = {
  [M in MethodName as Camel<M>]: (...params: Args<ParamsOf<Methods[M]>>) => Promise<ReplyOf<Methods[M]>>;
};
