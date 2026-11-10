/** The types the agent sandbox is built from: its environment and options, its plan profile, and its token proxy (sandbox.ts builds the arguments). */

export interface SandboxEnv {
  home: string;
  runtime: string;
  state: string;
  config: string;
}

export type Exists = (path: string) => "dir" | "file" | null;

export interface SandboxOptions {
  env: SandboxEnv;
  exists: Exists;
  bwrap: string;
  unit: string;
  /** The filtered bus's socket, when there is one. */
  bus: string | null;
  /** More arguments for bubblewrap before the command (the token proxy's). */
  extra?: readonly string[];
  /** A harness answering the launcher in plan mode (planProfile): a private home folder, and only the plan's socket. */
  plan?: PlanProfile;
}

/**
 * A harness answering the launcher (docs/actions.md, "Plan mode";
 * docs/secrets.md, "A harness in plan mode"): least access. Its home folder
 * is an empty one, with only what it needs bound back: its login and
 * sessions read-write (`state`), its install read-only (`readOnly`). No
 * Dashi MCP socket but this turn's plan socket, no session bus, no token
 * proxy. It starts in `cwd`, an empty folder of its own.
 */
export interface PlanProfile {
  /** This turn's plan-mode socket (agents/ask/harness/plan-server.ts), outside; or Dashi's MCP socket, for a task. */
  socket: string;
  readOnly: string[];
  state: string[];
  cwd: string;
  /**
   * A task from the launcher (agents/handoff/): the socket is Dashi's MCP
   * socket for tasks (`taskSocket`), its folder bound and the socket linked
   * where the bridge looks for it (`$XDG_RUNTIME_DIR/dashi-mcp.sock` inside),
   * not the plan socket's place. Everything else is the same least access:
   * an empty home folder, no bus, no token proxy.
   */
  task?: boolean;
}

/** The token proxy as dashi-agent got it from the shell, and the loopback port it relays to it. */
export interface TokenProxy {
  socket: string;
  ca: string;
  bundle: string;
  key: string;
  port: number;
}
