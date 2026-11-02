import { describe, expect, test } from "bun:test";
import type { Greetd } from "../src/greetd/client.ts";
import { Login, type LoginState, promptText } from "../src/greetd/login.ts";
import { encode, FrameReader, parseResponse, type Request, type Response } from "../src/greetd/protocol.ts";

describe("framing", () => {
  test("a frame is its length then its JSON, and reads back across chunk boundaries", () => {
    const frame = encode({ type: "create_session", username: "dashi" });
    const json = JSON.stringify({ type: "create_session", username: "dashi" });
    expect(new DataView(frame.buffer).getUint32(0, true)).toBe(json.length);
    const reader = new FrameReader();
    const twice = new Uint8Array([...frame, ...frame]);
    expect(reader.push(twice.subarray(0, 7))).toEqual([]);
    expect(reader.push(twice.subarray(7, frame.length + 2))).toEqual([json]);
    expect(reader.push(twice.subarray(frame.length + 2))).toEqual([json]);
  });

  test("responses parse; anything else is null", () => {
    expect(parseResponse('{"type":"success"}')).toEqual({ type: "success" });
    expect(parseResponse('{"type":"error","error_type":"auth_error","description":"nope"}')).toEqual({
      type: "error",
      errorType: "auth_error",
      description: "nope",
    });
    expect(parseResponse('{"type":"auth_message","auth_message_type":"secret","auth_message":"Password: "}')).toEqual({
      type: "auth_message",
      messageType: "secret",
      message: "Password: ",
    });
    expect(parseResponse('{"type":"auth_message","auth_message_type":"weird"}')).toBeNull();
    expect(parseResponse("not json")).toBeNull();
  });
});

/** A greetd that answers from a script and records what it was asked. */
function fakeGreetd(answer: (request: Request) => Response): Greetd & { sent: Request[] } {
  const sent: Request[] = [];
  return { sent, send: async (request) => (sent.push(request), answer(request)), close: () => {} };
}

const SESSION = { cmd: ["/usr/bin/dashi-session"], env: ["XDG_SESSION_TYPE=wayland"] };
const PASSWORD: Response = { type: "auth_message", messageType: "secret", message: "Password: " };

describe("Login", () => {
  test("password right: the session starts", async () => {
    const greetd = fakeGreetd((r) => (r.type === "create_session" ? PASSWORD : { type: "success" }));
    const states: LoginState[] = [];
    const login = new Login(greetd, (s) => states.push(s));
    await login.begin("dashi", SESSION);
    expect(login.current).toEqual({ kind: "prompt", message: "Password", secret: true, notice: null, wrong: false });
    await login.answer("test-dashi");
    expect(login.current).toEqual({ kind: "started" });
    expect(greetd.sent.map((r) => r.type)).toEqual(["create_session", "post_auth_message_response", "start_session"]);
    expect(greetd.sent[2]).toEqual({ type: "start_session", ...SESSION });
  });

  test("password wrong: a fresh session for the same person, marked wrong", async () => {
    const greetd = fakeGreetd((r) =>
      r.type === "post_auth_message_response"
        ? { type: "error", errorType: "auth_error", description: "auth" }
        : r.type === "cancel_session"
          ? { type: "success" }
          : PASSWORD,
    );
    const login = new Login(greetd, () => {});
    await login.begin("dashi", SESSION);
    await login.answer("wrong");
    expect(login.current).toMatchObject({ kind: "prompt", wrong: true });
    expect(greetd.sent.map((r) => r.type)).toEqual(["create_session", "post_auth_message_response", "cancel_session", "create_session"]);
  });

  test("PAM's info lines are acknowledged and shown", async () => {
    let step = 0;
    const greetd = fakeGreetd(() => [{ type: "auth_message", messageType: "info", message: "Touch the key" } as Response, PASSWORD][step++] ?? PASSWORD);
    const login = new Login(greetd, () => {});
    await login.begin("dashi", SESSION);
    expect(login.current).toMatchObject({ kind: "prompt", notice: "Touch the key" });
    expect(greetd.sent[1]).toEqual({ type: "post_auth_message_response" });
  });

  test("a session that will not start is an error", async () => {
    const greetd = fakeGreetd((r) => (r.type === "start_session" ? { type: "error", errorType: "error", description: "no such file" } : { type: "success" }));
    const login = new Login(greetd, () => {});
    await login.begin("dashi", SESSION);
    expect(login.current).toEqual({ kind: "error", message: "no such file" });
  });

  test("prompt text loses PAM's colon", () => {
    expect(promptText("Password: ")).toBe("Password");
    expect(promptText("Verification code:")).toBe("Verification code");
    expect(promptText("  ")).toBe("Password");
  });
});
