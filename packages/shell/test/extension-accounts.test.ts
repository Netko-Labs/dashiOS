/**
 * Accounts for extensions (src/shared/extension-settings): PKCE by the book
 * (S256, checked against another hash), a sign-in through a loopback callback against a
 * stand-in provider (nothing here reaches GitHub), the exchange sending the
 * verifier and never a client secret, the token kept in the keyring and
 * only who it is on disk, a pasted token checked first, Disconnect, and
 * Claude's and ChatGPT's subscriptions refused as providers.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Manifest, parseManifest, parsePermission } from "@dashi/applet";
import { ExtensionAccounts, type Provider, providerFor, secretsInMemory, signIn } from "../src/shared/extension-settings/index.ts";
import { authorizeUrl, callbackOf, challengeOf, exchangeBody, pkcePair, tokensOf } from "../src/shared/extension-settings/lib/pkce.ts";

const PROVIDER: Provider = {
  id: "github.com",
  name: "GitHub",
  authorize: "https://github.example/login/oauth/authorize",
  token: "https://github.example/login/oauth/access_token",
  user: "https://api.github.example/user",
  clientId: "Iv1.dashi-example",
  kept: "The key is in your keyring.",
};

function manifest(): Manifest {
  const parsed = parseManifest({
    id: "dev.example.issues",
    name: "Issues",
    version: "0.1.0",
    dashi: ">=0.9",
    entry: "main.tsx",
    summary: "Files issues.",
    author: { name: "Alex Kim" },
    shows: ["launcher"],
    permissions: ["network:api.github.com", "account:github.com"],
    accounts: [{ provider: "github.com", scopes: ["repo"] }],
  });
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

/** The stand-in provider: the token endpoint (what it was sent) and the user endpoint. */
function provider(): { fetch: typeof fetch; exchanged: URLSearchParams[] } {
  const exchanged: URLSearchParams[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === PROVIDER.token) {
      const body = new URLSearchParams(String(init?.body ?? ""));
      exchanged.push(body);
      const good = body.get("code") === "the-code" && challengeOf(body.get("code_verifier") ?? "") === lastChallenge;
      return Response.json(good ? { access_token: "gho_example", scope: "repo", token_type: "bearer" } : { error: "bad_verification_code" });
    }
    if (url === PROVIDER.user) {
      const auth = new Headers(init?.headers).get("authorization");
      return auth === "Bearer gho_example" ? Response.json({ login: "alexk" }) : new Response("", { status: 401 });
    }
    return new Response("", { status: 404 });
  };
  return { fetch: fake as typeof fetch, exchanged };
}

let lastChallenge = "";

describe("PKCE", () => {
  test("S256 is the verifier's SHA-256 in base64url, no padding (checked against openssl's: 3C52H5Cm…)", () => {
    const verifier = "dBjftJeZ4CVP-mJ92K9mxpkzGsmtyBvy2s5mT0F1ijU";
    expect(challengeOf(verifier)).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(challengeOf(verifier)).toBe("3C52H5Cm1CgJ7vweGxqwaESv1P8Vs0IPpjB-wse-Ar8");
    expect(pkcePair().verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("the page's address carries the challenge and the state; the exchange the verifier, never a secret", () => {
    const url = new URL(authorizeUrl(PROVIDER, { redirect: "http://127.0.0.1:4000/callback", scopes: ["repo"], state: "s1", challenge: "c1" }));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "Iv1.dashi-example", code_challenge: "c1", code_challenge_method: "S256", state: "s1", scope: "repo" });
    const body = exchangeBody(PROVIDER, "the-code", "http://127.0.0.1:4000/callback", "v1");
    expect(body.get("code_verifier")).toBe("v1");
    expect(body.has("client_secret")).toBe(false);
  });

  test("a callback for another sign-in, or a no, is refused; the provider's errors come back in words", () => {
    expect(callbackOf(new URL("http://127.0.0.1/callback?code=x&state=other"), "mine")).toEqual({ error: "The answer wasn't for this sign-in." });
    expect(callbackOf(new URL("http://127.0.0.1/callback?error=access_denied&state=mine"), "mine")).toEqual({ error: "You said no on the sign-in page." });
    expect(callbackOf(new URL("http://127.0.0.1/callback?code=x&state=mine"), "mine")).toEqual({ code: "x" });
    expect(tokensOf({ error: "bad_verification_code", error_description: "The code passed is incorrect or expired." }, 0)).toEqual({
      error: "The code passed is incorrect or expired.",
    });
    expect(tokensOf({ access_token: "t", scope: "repo,read:org", refresh_token: "r", expires_in: 60 }, 1000)).toEqual({ token: "t", scopes: ["repo", "read:org"], refresh: "r", expires: 61_000 });
  });
});

describe("signing in", () => {
  test("the browser comes back to the loopback with the code; Dashi exchanges it with its verifier and learns who it is", async () => {
    const { fetch: fake, exchanged } = provider();
    const signed = await signIn(PROVIDER, ["repo"], {
      fetch: fake,
      // The person's browser: it opens the page and comes back with the code, as GitHub would send it.
      open: async (page) => {
        const asked = new URL(page);
        lastChallenge = asked.searchParams.get("code_challenge") ?? "";
        const back = new URL(asked.searchParams.get("redirect_uri") ?? "");
        expect(back.hostname).toBe("127.0.0.1");
        back.searchParams.set("code", "the-code");
        back.searchParams.set("state", asked.searchParams.get("state") ?? "");
        const page2 = await fetch(back);
        expect(await page2.text()).toContain("Connected to GitHub as alexk");
        return true;
      },
    });
    expect(signed).toMatchObject({ login: "alexk", token: "gho_example", scopes: ["repo"] });
    expect(exchanged[0]?.has("client_secret")).toBe(false);
  });
});

describe("an extension's accounts", () => {
  test("kept in the keyring, only the login on disk; given to the extension; disconnected", async () => {
    const root = mkdtempSync(join(tmpdir(), "dashi-accounts-"));
    const secrets = secretsInMemory();
    const { fetch: fake } = provider();
    const accounts = new ExtensionAccounts(root, secrets, fake);
    const issues = manifest();
    expect(accounts.rows(issues)).toMatchObject([{ id: "github.com", login: null, asked: false, scopes: ["repo"] }]);
    expect(await accounts.paste(issues, PROVIDER, "not-a-token")).toEqual({ error: "GitHub didn't take that token." });
    expect(await accounts.paste(issues, PROVIDER, " gho_example ")).toEqual({ login: "alexk" });
    expect(await accounts.given(issues)).toEqual({ "github.com": { login: "alexk", token: "gho_example" } });
    const onDisk = readFileSync(join(root, "dev.example.issues.accounts.json"), "utf8");
    expect(onDisk).toContain("alexk");
    expect(onDisk).not.toContain("gho_example");
    accounts.agreed(issues, "github.com");
    await accounts.disconnect(issues, "github.com");
    expect(await accounts.given(issues)).toEqual({});
    expect(accounts.rows(issues)[0]).toMatchObject({ login: null, asked: true });
    expect(existsSync(join(root, "dev.example.issues.accounts.json"))).toBe(true);
  });

  test("Claude's and ChatGPT's subscriptions are never providers", () => {
    for (const host of ["claude.ai", "anthropic.com", "chatgpt.com", "openai.com", "auth.openai.com"]) {
      expect(parsePermission(`account:${host}`)).toMatchObject({ error: expect.stringContaining("never signs in") });
      expect(providerFor(host)).toBeNull();
    }
    expect(providerFor("github.com", { DASHI_GITHUB_CLIENT_ID: "Iv1.example" })?.clientId).toBe("Iv1.example");
  });
});
