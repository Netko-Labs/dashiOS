/**
 * Signing an extension in to the person's account (store-v2 spec § 4.4):
 * Dashi listens on a loopback port for this one sign-in, opens the
 * provider's page in Helium, and when the browser comes back with a code,
 * trades it for a token with the PKCE verifier (lib/pkce.ts), then asks who
 * the token belongs to. The extension never takes part: it gets the token
 * over the channel afterwards (accounts.ts keeps it).
 *
 * The loopback server answers one request on `/callback` and goes; it is
 * TCP on 127.0.0.1 (the provider's browser page must reach it), never a
 * socket in the runtime folder.
 */

import { isRecord } from "@dashi/shape";
import { authorizeUrl, callbackOf, exchangeBody, pkcePair, randomState, type Tokens, tokensOf } from "./lib/pkce.ts";
import type { Provider } from "./providers.ts";

/** How long the person has to say yes in the browser. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export interface SignedIn extends Tokens {
  login: string;
}

export interface SignInNeeds {
  /** Opens the provider's page (Helium). */
  open(url: string): Promise<boolean>;
  fetch?: typeof fetch;
  now?: () => number;
  /** Runs `fn` after `ms`; what it returns cancels it. */
  later?(fn: () => void, ms: number): () => void;
}

const PAGE = (words: string): Response =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Dashi</title><body style="font:16px system-ui;margin:4em auto;max-width:28em">${words}</body>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

/** Words ending as a sentence ends ("Not Found" → "Not Found."). */
const sentence = (words: string): string => (/[.!?]$/.test(words.trim()) ? words.trim() : `${words.trim()}.`);

/** Who the token belongs to, by the provider's own answer; null when it isn't a working token. */
export async function loginOf(provider: Provider, token: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const reply = await fetcher(provider.user, { headers: { authorization: `Bearer ${token}`, accept: "application/json", "user-agent": "Dashi" } });
    if (!reply.ok) return null;
    const body: unknown = await reply.json();
    return isRecord(body) && typeof body.login === "string" && body.login !== "" ? body.login : null;
  } catch {
    return null;
  }
}

async function exchange(provider: Provider, code: string, redirect: string, verifier: string, needs: SignInNeeds): Promise<Tokens | { error: string }> {
  const fetcher = needs.fetch ?? fetch;
  try {
    const reply = await fetcher(provider.token, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "Dashi" },
      body: exchangeBody(provider, code, redirect, verifier),
    });
    return tokensOf(await reply.json(), (needs.now ?? Date.now)());
  } catch {
    return { error: `Couldn't reach ${provider.name}.` };
  }
}

/** Signs in at `provider` for `scopes`: the account's tokens and login, or why not, in words for the person. */
export function signIn(provider: Provider, scopes: readonly string[], needs: SignInNeeds): Promise<SignedIn | { error: string }> {
  const { verifier, challenge } = pkcePair();
  const state = randomState();
  const later = needs.later ?? ((fn: () => void, ms: number) => clearTimeout.bind(null, setTimeout(fn, ms)));
  return new Promise((resolve) => {
    let finished = false;
    let redirect = "";
    const finish = (outcome: SignedIn | { error: string }): void => {
      if (finished) return;
      finished = true;
      cancel();
      // After this answer is out: the page the browser shows is the last thing it asks of the server.
      queueMicrotask(() => server.stop());
      resolve(outcome);
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname !== "/callback" || finished) return new Response("", { status: 404 });
        const answer = callbackOf(url, state);
        if ("error" in answer) {
          finish(answer);
          return PAGE(`${answer.error} You can close this tab.`);
        }
        const tokens = await exchange(provider, answer.code, redirect, verifier, needs);
        if ("error" in tokens) {
          finish(tokens);
          return PAGE(`${provider.name} didn't connect: ${sentence(tokens.error)} You can close this tab.`);
        }
        const login = await loginOf(provider, tokens.token, needs.fetch);
        finish(login ? { ...tokens, login } : { error: `${provider.name} gave a token that doesn't work.` });
        return PAGE(
          login ? `Connected to ${provider.name} as ${login}. You can close this tab and go back to Dashi.` : "That didn't work. You can close this tab.",
        );
      },
    });
    redirect = `http://127.0.0.1:${server.port}/callback`;
    const cancel = later(() => finish({ error: `No answer from ${provider.name}'s page in five minutes.` }), SIGN_IN_TIMEOUT_MS);
    void needs.open(authorizeUrl(provider, { redirect, scopes, state, challenge })).then((opened) => {
      if (!opened) finish({ error: "Couldn't open the browser." });
    });
  });
}
