/**
 * Logging someone in through greetd: open a session for them, answer what PAM
 * asks (a password, a code), and start the session they chose once PAM is
 * satisfied. A wrong answer cancels and opens a fresh session for the same
 * person, so the field is ready again. The password is sent to greetd and
 * nowhere else; it is not kept.
 */

import type { Greetd } from "./client.ts";
import type { Response } from "./protocol.ts";

export type LoginState =
  /** Nobody chosen yet, or between attempts. */
  | { kind: "idle" }
  /** PAM asks something: `secret` hides what is typed. `notice` is PAM's last info or error line. */
  | { kind: "prompt"; message: string; secret: boolean; notice: string | null; wrong: boolean }
  | { kind: "checking" }
  /** In; the session is starting and the greeter is about to go. */
  | { kind: "started" }
  | { kind: "error"; message: string };

export interface SessionCommand {
  cmd: string[];
  env: string[];
}

export class Login {
  private state: LoginState = { kind: "idle" };
  private user: string | null = null;
  private session: SessionCommand | null = null;
  private notice: string | null = null;

  constructor(
    private readonly greetd: Greetd,
    private readonly onChange: (state: LoginState) => void,
  ) {}

  get current(): LoginState {
    return this.state;
  }

  /** Start over for `user`, who will get `session` once in. */
  async begin(user: string, session: SessionCommand): Promise<void> {
    if (this.user !== null) await this.greetd.send({ type: "cancel_session" }).catch(() => undefined);
    this.user = user;
    this.session = session;
    this.notice = null;
    await this.handle(await this.greetd.send({ type: "create_session", username: user }), false);
  }

  /** The session to start, changed after `begin` (the picker under the field). */
  choose(session: SessionCommand): void {
    this.session = session;
  }

  /** Answer the current prompt. */
  async answer(text: string): Promise<void> {
    if (this.state.kind !== "prompt") return;
    this.set({ kind: "checking" });
    await this.handle(await this.greetd.send({ type: "post_auth_message_response", response: text }), false);
  }

  private async handle(response: Response, wrong: boolean): Promise<void> {
    switch (response.type) {
      case "auth_message":
        if (response.messageType === "info" || response.messageType === "error") {
          // Shown under the field; greetd wants these acknowledged with no answer.
          this.notice = response.message.trim() || null;
          return this.handle(await this.greetd.send({ type: "post_auth_message_response" }), wrong);
        }
        return this.set({ kind: "prompt", message: promptText(response.message), secret: response.messageType === "secret", notice: this.notice, wrong });
      case "success":
        return this.start();
      case "error":
        await this.greetd.send({ type: "cancel_session" }).catch(() => undefined);
        if (response.errorType === "auth_error" && this.user && this.session) {
          this.notice = null;
          return this.handle(await this.greetd.send({ type: "create_session", username: this.user }), true);
        }
        this.user = null;
        return this.set({ kind: "error", message: response.description || "Logging in failed." });
    }
  }

  private async start(): Promise<void> {
    if (!this.session) return this.set({ kind: "error", message: "No session to start." });
    const response = await this.greetd.send({ type: "start_session", cmd: this.session.cmd, env: this.session.env });
    if (response.type === "success") return this.set({ kind: "started" });
    await this.greetd.send({ type: "cancel_session" }).catch(() => undefined);
    this.user = null;
    this.set({ kind: "error", message: response.type === "error" ? response.description || "The session did not start." : "The session did not start." });
  }

  private set(state: LoginState): void {
    this.state = state;
    this.onChange(state);
  }
}

/** PAM's "Password: " as a field's placeholder: "Password". */
export function promptText(message: string): string {
  const text = message.trim().replace(/:$/, "").trim();
  return text || "Password";
}
