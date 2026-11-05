import { afterAll, describe, expect, test } from "bun:test";
import { type Cbor, encode } from "./fixtures/sign-in-site/cbor.ts";
import { start, TEST_CARD, TEST_LOGIN } from "./fixtures/sign-in-site/server.ts";
import { base32, hotp, totp } from "./fixtures/sign-in-site/totp.ts";

const site = start(0);
afterAll(() => site.stop());
const base = site.url.replace(TEST_LOGIN.site, "127.0.0.1");

/** A browser of sorts: follows nothing, keeps the session cookie. */
function client() {
  let cookie = "";
  return async (path: string, form?: Record<string, string>) => {
    const response = await fetch(new URL(path, base), {
      method: form ? "POST" : "GET",
      redirect: "manual",
      headers: { cookie },
      ...(form ? { body: new URLSearchParams(form) } : {}),
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0] ?? "";
    return { status: response.status, location: response.headers.get("location"), text: await response.text() };
  };
}

describe("the test site", () => {
  test("its TOTP is RFC 6238's (and so dashi-secretd's)", async () => {
    const seed = new TextEncoder().encode("12345678901234567890");
    expect(await totp(seed, 59, 8)).toBe("94287082");
    expect(await totp(seed, 1111111109, 8)).toBe("07081804");
    expect(await hotp(seed, 0)).toBe("755224");
    expect(base32(new TextEncoder().encode("1234567890"))).toBe("GEZDGNBVGY3TQOJQ");
  });

  test("the login page has a real password field, then the code, then the account", async () => {
    const browse = client();
    const login = await browse("/");
    expect(login.text).toContain('type="password"');
    expect((await browse("/login", { username: TEST_LOGIN.account, password: "wrong" })).text).toContain("don't match");
    const signedIn = await browse("/login", { username: TEST_LOGIN.account, password: TEST_LOGIN.password });
    expect(signedIn.location).toBe("/2fa");
    expect((await browse("/account")).location).toBe("/");
    const code = await totp(TEST_LOGIN.totp, Math.floor(Date.now() / 1000));
    expect((await browse("/2fa", { code })).location).toBe("/account");
    expect((await browse("/account")).text).toContain(`signed in as ${TEST_LOGIN.account}`);
    expect(site.events.filter((e) => !e.startsWith("passkey"))).toEqual(["password wrong", "password ok", "code ok"]);
  });

  test("passkeys: made and used as a real site checks them, and a bad signature is refused", async () => {
    const origin = new URL(base).origin;
    const host = new URL(base).hostname;
    const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
    const rpHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(host)));
    const credential = crypto.getRandomValues(new Uint8Array(32));
    const json = async (path: string, body?: unknown) => {
      const response = await fetch(new URL(path, base), body ? { method: "POST", body: JSON.stringify(body) } : {});
      return { status: response.status, text: await response.text() };
    };
    const clientData = (type: string, challenge: string) => new TextEncoder().encode(JSON.stringify({ type, challenge, origin }));
    const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

    const { challenge } = JSON.parse((await json("/passkey/options")).text) as { challenge: string };
    const cose = encode(
      new Map<Cbor, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, raw.slice(1, 33)],
        [-3, raw.slice(33)],
      ]),
    );
    const authData = new Uint8Array([...rpHash, 0x45, 0, 0, 0, 0, ...new Uint8Array(16), 0, 32, ...credential, ...cose]);
    const attestation = encode(
      new Map<Cbor, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    const made = await json("/passkey/register", { clientDataJSON: b64(clientData("webauthn.create", challenge)), attestationObject: b64(attestation) });
    expect(made.text).toContain("saved");

    const sign = async (count: number, tamper = false) => {
      const { challenge } = JSON.parse((await json("/passkey/options")).text) as { challenge: string };
      const data = clientData("webauthn.get", challenge);
      const auth = new Uint8Array([...rpHash, 0x05, 0, 0, 0, count]);
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
      const p1363 = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new Uint8Array([...auth, ...hash])));
      if (tamper) p1363[10] = (p1363[10] ?? 0) ^ 1;
      // DER, as authenticators send it.
      const int = (b: Uint8Array) => ((b[0] ?? 0) & 0x80 ? [0x02, b.length + 1, 0, ...b] : [0x02, b.length, ...b]);
      const body = [...int(p1363.slice(0, 32)), ...int(p1363.slice(32))];
      const der = new Uint8Array([0x30, body.length, ...body]);
      return json("/passkey/login", { id: b64(credential), clientDataJSON: b64(data), authenticatorData: b64(auth), signature: b64(der) });
    };
    expect((await sign(1)).text).toContain("Signed in");
    expect((await sign(2, true)).status).toBe(400);
    expect((await sign(1)).text).toContain("went back");
    expect(site.events).toContain("passkey ok");
  });

  test("the checkout takes only a well-formed test card", async () => {
    const browse = client();
    expect((await browse("/pay", { number: "1234 5678", expiry: "12/34", cvc: "123" })).text).toContain("refused");
    expect((await browse("/pay", { ...TEST_CARD })).text).toContain("ending 4242");
  });
});
