/**
 * A native window's element tree as agents get it (docs/actions.md, "Native
 * windows"): an `Element` is one AT-SPI node read once, plain data, so the
 * reading (lib/bus.ts) and the writing out (lib/render.ts) are apart and the
 * second is tested on trees recorded in the VM.
 */

import type { CompositorWindow } from "../../compositor/index.ts";
import type { A11yNode } from "../atspi/index.ts";
import type { Question } from "../confirm.ts";
import type { TreeNumbers } from "./lib/numbers.ts";

export interface ElementValue {
  now: number;
  min: number;
  max: number;
  /** The smallest step (0 when the toolkit says none). */
  step: number;
  /** The value as words, where the toolkit gives them ("50%"). */
  text?: string;
}

export interface Element {
  /** Which object it is: the app's bus name and the node's path. Stable while the node lives. */
  key: string;
  /** The toolkit's own id for it (AT-SPI's AccessibleId: GTK's, a React key), when it gives one. */
  id?: string;
  /** AT-SPI's role (AtspiRole). */
  role: number;
  name: string;
  description: string;
  /** GetState's two words. */
  states: readonly number[];
  /** Its attributes (`level` for a heading, `placeholder-text`, `toolkit`…). */
  attributes: Readonly<Record<string, string>>;
  /** The AT-SPI interfaces it has, without the `org.a11y.atspi.` prefix ("Action", "Text"…). */
  interfaces: readonly string[];
  /** Its Action interface's actions, by name ("click", "press", "activate", "expand or contract"). */
  actions: readonly string[];
  value?: ElementValue;
  /** What its Text interface holds (cut at MAX_TEXT). Never read for a secret field. */
  text?: string;
  /** How many characters its Text holds: for a secret field, all that is asked (filled or not). */
  chars?: number;
  /** Where the caret is in `text`, for a field that has the keyboard. */
  caret?: number;
  /** Its place among a list's rows, from 0 (only under a list, which is read a page at a time). */
  row?: number;
  /** How many children the toolkit says it has (more than `children` when the walk stopped or a list holds more than it shows). */
  childCount: number;
  children: Element[];
}

/** A window's tree as read: its root (the AT-SPI frame), and whether the walk saw all of it. */
export interface WindowTree {
  root: Element;
  /** False when the walk ran out of nodes or time: the text says so. */
  complete: boolean;
  /** How long reading it took. */
  ms: number;
}

/** What the person keeps to themselves: a window an agent may know is there, never read or act in. */
export type PersonOnly = "setup" | "vault" | "handed-over" | "consent";

/** The accessibility bus as the window tree needs it (atspi/client.ts's Atspi). */
export interface TreeBus {
  appFor(pid: number): Promise<A11yNode | null>;
  wake?(pid: number, again?: boolean): Promise<boolean>;
  watchChanges?(): Promise<void>;
  changesOf?(node: A11yNode): { count: number; at: number };
}

/** What the window tools need from the connection (RunContext.trees). */
export interface TreesRun {
  bus(): Promise<TreeBus | null>;
  /** This connection's element numbers. */
  numbers: TreeNumbers;
  /** Whether a window is the person's alone, and why. */
  personOnly(window: CompositorWindow): PersonOnly | null;
  /** Ask before an action that deletes, sends or pays: the assistant's spoken yes, else a sheet (D221). */
  yes(question: Question): Promise<boolean>;
}
