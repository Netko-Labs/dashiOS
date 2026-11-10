/**
 * How Files names what it works on in the footer: “a.txt” or 3 items.
 */

import { baseName } from "../../../src/shared/files/paths.ts";
import { formatCount } from "./format.ts";

export const quote = (name: string): string => `“${name}”`;

/** "3 items" or "“a.txt”". */
export const what = (paths: readonly string[]): string => (paths.length === 1 ? quote(baseName(paths[0] as string)) : formatCount(paths.length));
