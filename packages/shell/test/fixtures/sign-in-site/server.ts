/**
 * A local sign-in site for testing agents' secrets (docs/secrets.md, "The
 * test site"), never a real account or card: a login form, a two-factor
 * code (TOTP), a passkey page (WebAuthn, passkey.ts), and a fake checkout.
 *
 *   bun packages/shell/test/fixtures/sign-in-site/server.ts [--port 8443]
 *
 * Open http://signin.localhost:<port>/ (browsers send *.localhost to this
 * machine, and Dashi fills http only on loopback names). Its login is
 * TEST_LOGIN; save it in Dashi's vault with the two-factor secret printed at
 * start.
 */

import { passkeyRoutes } from "./passkey.ts";
import { base32, totp } from "./totp.ts";

export const TEST_LOGIN = {
  site: "signin.localhost",
  account: "alexk",
  password: "correct-horse-battery-staple",
  /** The TOTP secret's bytes (base32 in `start`'s output). */
  totp: new TextEncoder().encode("dashi-test-secret-20"),
} as const;

/** The test card: Stripe's test number, which no bank accepts. */
export const TEST_CARD = { number: "4242424242424242", expiry: "12/34", cvc: "123" } as const;
export const TEST_AMOUNT = "4.20";

type Stage = "password" | "code" | "in";

const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;max-width:420px;margin:60px auto}label{display:block;margin:12px 0 4px}input{font:inherit;padding:6px;width:100%}button{font:inherit;margin-top:16px;padding:6px 16px}</style>
</head><body><h1>${title}</h1>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

function luhn(number: string): boolean {
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let digit = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return number.length >= 12 && sum % 10 === 0;
}

export interface Site {
  url: string;
  stop(): void;
  /** What happened, for tests: "signed in", "code ok", "paid 4.20", … */
  events: string[];
}

export function start(port = 0): Site {
  const sessions = new Map<string, Stage>();
  const events: string[] = [];
  const passkeys = passkeyRoutes(events);
  const stage = (request: Request): [string, Stage] => {
    const id = /session=([a-f0-9-]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
    if (id && sessions.has(id)) return [id, sessions.get(id) as Stage];
    const fresh = crypto.randomUUID();
    sessions.set(fresh, "password");
    return [fresh, "password"];
  };
  const go = (to: string, session: string) =>
    new Response(null, { status: 303, headers: { location: to, "set-cookie": `session=${session}; Path=/; HttpOnly` } });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const [session, now] = stage(request);
      const form = request.method === "POST" ? await request.formData() : null;
      const passkey = await passkeys(request, url);
      if (passkey) return passkey;
      switch (`${request.method} ${url.pathname}`) {
        case "GET /":
          if (now === "in") return go("/account", session);
          return page(
            "Sign in to the test site",
            `<form method="post" action="/login"><label for="u">User name</label><input id="u" name="username" autocomplete="username" autofocus>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password"><button>Sign in</button></form>`,
          );
        case "POST /login":
          if (form?.get("username") === TEST_LOGIN.account && form?.get("password") === TEST_LOGIN.password) {
            sessions.set(session, "code");
            events.push("password ok");
            return go("/2fa", session);
          }
          events.push("password wrong");
          return page("Sign in to the test site", `<p>That user name and password don't match.</p><p><a href="/">Try again</a></p>`);
        case "GET /2fa":
          return page(
            "Two-factor code",
            `<form method="post" action="/2fa"><label for="c">The 6-digit code from your app</label><input id="c" name="code" inputmode="numeric" autocomplete="one-time-code" autofocus><button>Verify</button></form>`,
          );
        case "POST /2fa": {
          const t = Math.floor(Date.now() / 1000);
          const good = await Promise.all([t - 30, t, t + 30].map((at) => totp(TEST_LOGIN.totp, at)));
          if (now === "code" && good.includes(String(form?.get("code") ?? ""))) {
            sessions.set(session, "in");
            events.push("code ok");
            return go("/account", session);
          }
          events.push("code wrong");
          return page("Two-factor code", `<p>That code is wrong.</p><p><a href="/2fa">Try again</a></p>`);
        }
        case "GET /account":
          if (now !== "in") return go("/", session);
          return page(
            "Signed in",
            `<p>You are signed in as ${TEST_LOGIN.account}.</p><p><a href="/checkout">Buy a test item</a> · <a href="/passkey">Passkeys</a></p>`,
          );
        case "GET /checkout":
          return page(
            "Checkout",
            `<p>One test item: $${TEST_AMOUNT}</p><form method="post" action="/pay"><label for="n">Card number</label><input id="n" name="number" autocomplete="cc-number">
<label for="e">Expiry</label><input id="e" name="expiry" autocomplete="cc-exp" placeholder="MM/YY"><label for="v">Security code</label><input id="v" name="cvc" type="password" autocomplete="cc-csc"><button>Pay $${TEST_AMOUNT}</button></form>`,
          );
        case "POST /pay": {
          const number = String(form?.get("number") ?? "").replace(/\s/g, "");
          if (luhn(number) && /^\d{2}\/\d{2}$/.test(String(form?.get("expiry") ?? "")) && /^\d{3,4}$/.test(String(form?.get("cvc") ?? ""))) {
            events.push(`paid ${TEST_AMOUNT}`);
            return page("Paid", `<p>Paid $${TEST_AMOUNT} with the card ending ${number.slice(-4)}. Nothing was charged: this is a test site.</p>`);
          }
          events.push("payment refused");
          return page("Checkout", "<p>The card was refused.</p>");
        }
        default:
          return new Response("Not found", { status: 404 });
      }
    },
  });
  return { url: `http://${TEST_LOGIN.site}:${server.port}/`, stop: () => server.stop(true), events };
}

if (import.meta.main) {
  const at = process.argv.indexOf("--port");
  const site = start(at > 0 ? Number(process.argv[at + 1]) : 8443);
  console.log(`The test site is at ${site.url}`);
  console.log(`Its login: ${TEST_LOGIN.account} on ${TEST_LOGIN.site}; two-factor setup key ${base32(TEST_LOGIN.totp)}`);
}
