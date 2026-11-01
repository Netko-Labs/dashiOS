/**
 * dashi-session's supervisor, the command dashi-comp runs with `-c`:
 *
 *   dashi-comp -c 'bun shell/src/session.ts'
 *
 * Restarts the shell when it crashes (shell/src/session/).
 */

import { runSession } from "./session/index.ts";

process.exit(await runSession());
