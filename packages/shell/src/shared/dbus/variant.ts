/** A value tagged with its own signature: D-Bus's `v`. */

import { parseSingle } from "./lib/signature.ts";

export class Variant {
  constructor(
    /** One complete type, such as `s`, `u`, `a{sv}`, or `(ii)`. */
    readonly signature: string,
    readonly value: unknown,
  ) {
    parseSingle(signature);
  }
}

export const variant = (signature: string, value: unknown): Variant => new Variant(signature, value);
