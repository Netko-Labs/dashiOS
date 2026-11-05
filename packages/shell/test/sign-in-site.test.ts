import { afterAll, describe, expect, test } from "bun:test";
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
    expect(site.events).toEqual(["password wrong", "password ok", "code ok"]);
  });

  test("the checkout takes only a well-formed test card", async () => {
    const browse = client();
    expect((await browse("/pay", { number: "1234 5678", expiry: "12/34", cvc: "123" })).text).toContain("refused");
    expect((await browse("/pay", { ...TEST_CARD })).text).toContain("ending 4242");
  });
});
