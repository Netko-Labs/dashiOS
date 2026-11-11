/** The vault's token items as the shell sees them (docs/secrets.md, "Tokens that stay home"), and a field a secret may go in. */

import type { Focused } from "../atspi/index.ts";

/** A token item as anyone may see it: no token (docs/secrets.md, "Tokens that stay home"). */
export interface TokenSummary {
  id: number;
  /** Agents hold `dashi:<name>`. */
  name: string;
  hosts: string[];
  /** Where the token may go, "Authorization: Bearer {}" first by default: the proxy swaps it in whichever the request sent. */
  headers: string[];
  lastUsed: number | null;
}

export interface NewToken {
  name: string;
  hosts: string[];
  /** Unset: "Authorization: Bearer {}". */
  headers?: string[];
  token: string;
}

export interface TokenChange {
  hosts?: string[];
  headers?: string[];
  /** Empty or absent keeps the token there. */
  token?: string;
}

/** The field focused for a secret, and the browser's command line (lib/field-check.ts decides). */
export interface FieldInfo {
  focused: Focused | null;
  /** The browser's command line, when it can be read. */
  cmdline: readonly string[] | null;
}
