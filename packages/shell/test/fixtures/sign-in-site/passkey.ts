/**
 * The test site's passkeys (WebAuthn, "none" attestation, ES256): a page
 * that makes one and signs in with it, and the server's checks, as a real
 * site makes them: the challenge, the origin, the site's id hash, user
 * presence and verification, the signature, and a growing counter.
 */

import { type Cbor, decode } from "./cbor.ts";

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const unb64url = (text: unknown): Uint8Array => new Uint8Array(Buffer.from(typeof text === "string" ? text : "", "base64url"));

interface Stored {
  id: string;
  key: CryptoKey;
  count: number;
}

/** DER's ECDSA signature (SEQUENCE of two INTEGERs) to WebCrypto's r‖s. */
export function derToRaw(der: Uint8Array): Uint8Array {
  const out = new Uint8Array(64);
  let at = 2;
  for (const offset of [0, 32]) {
    if (der[at] !== 0x02) throw new Error("not a DER signature");
    const length = der[at + 1] ?? 0;
    let value = der.subarray(at + 2, at + 2 + length);
    while (value.length > 32 && value[0] === 0) value = value.subarray(1);
    out.set(value, offset + 32 - value.length);
    at += 2 + length;
  }
  return out;
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Passkeys</title>
<style>body{font:16px system-ui;max-width:420px;margin:60px auto}button{font:inherit;margin:8px 8px 0 0;padding:6px 16px}</style></head>
<body><h1>Passkeys</h1><p id="state">No passkey yet.</p>
<button id="create">Create a passkey</button><button id="use">Sign in with a passkey</button>
<script>
const b = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const u = (a) => btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
const say = (t) => (document.getElementById("state").textContent = t);
document.getElementById("create").onclick = async () => {
  const o = await (await fetch("/passkey/options")).json();
  const c = await navigator.credentials.create({ publicKey: { challenge: b(o.challenge), rp: { id: location.hostname, name: "Test site" },
    user: { id: b(o.user), name: "alexk", displayName: "Alex Kim" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: { residentKey: "required", userVerification: "required" } } });
  const r = await fetch("/passkey/register", { method: "POST", body: JSON.stringify({ clientDataJSON: u(c.response.clientDataJSON), attestationObject: u(c.response.attestationObject) }) });
  say(await r.text());
};
document.getElementById("use").onclick = async () => {
  const o = await (await fetch("/passkey/options")).json();
  const a = await navigator.credentials.get({ publicKey: { challenge: b(o.challenge), rpId: location.hostname, userVerification: "required" } });
  const r = await fetch("/passkey/login", { method: "POST", body: JSON.stringify({ id: u(a.rawId), clientDataJSON: u(a.response.clientDataJSON),
    authenticatorData: u(a.response.authenticatorData), signature: u(a.response.signature) }) });
  say(await r.text());
};
</script></body></html>`;

export function passkeyRoutes(events: string[]): (request: Request, url: URL) => Promise<Response | null> {
  const challenges = new Set<string>();
  const stored = new Map<string, Stored>();
  const refuse = (why: string) => {
    events.push(`passkey refused: ${why}`);
    return new Response(`Refused: ${why}`, { status: 400 });
  };
  const clientData = (url: URL, json: Uint8Array, type: string): string | null => {
    const data = JSON.parse(new TextDecoder().decode(json)) as Record<string, unknown>;
    if (data.type !== type) return "the wrong ceremony";
    if (typeof data.challenge !== "string" || !challenges.delete(data.challenge)) return "an unknown challenge";
    if (data.origin !== url.origin) return "another origin";
    return null;
  };
  const rpHash = async (url: URL) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url.hostname)));
  const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

  return async (request, url) => {
    switch (`${request.method} ${url.pathname}`) {
      case "GET /passkey":
        return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
      case "GET /passkey/options": {
        const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
        challenges.add(challenge);
        return Response.json({ challenge, user: b64url(new TextEncoder().encode("alexk-handle")) });
      }
      case "POST /passkey/register": {
        const body = (await request.json()) as Record<string, unknown>;
        const why = clientData(url, unb64url(body.clientDataJSON), "webauthn.create");
        if (why) return refuse(why);
        const attestation = decode(unb64url(body.attestationObject)).value;
        const authData = attestation instanceof Map ? attestation.get("authData") : null;
        if (!(authData instanceof Uint8Array) || authData.length < 55) return refuse("no authenticator data");
        if (!same(authData.subarray(0, 32), await rpHash(url))) return refuse("another site's id");
        if (((authData[32] ?? 0) & 0x45) !== 0x45) return refuse("no presence, verification, or key");
        const length = ((authData[53] ?? 0) << 8) | (authData[54] ?? 0);
        const id = b64url(authData.subarray(55, 55 + length));
        const cose = decode(authData.subarray(55 + length)).value as Map<Cbor, Cbor>;
        const x = cose.get(-2);
        const y = cose.get(-3);
        if (cose.get(3) !== -7 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array)) return refuse("not an ES256 key");
        const raw = new Uint8Array([4, ...x, ...y]);
        const key = await crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        stored.set(id, { id, key, count: 0 });
        events.push("passkey registered");
        return new Response("A passkey was saved for alexk.");
      }
      case "POST /passkey/login": {
        const body = (await request.json()) as Record<string, unknown>;
        const json = unb64url(body.clientDataJSON);
        const why = clientData(url, json, "webauthn.get");
        if (why) return refuse(why);
        const passkey = stored.get(typeof body.id === "string" ? body.id : "");
        if (!passkey) return refuse("an unknown passkey");
        const auth = unb64url(body.authenticatorData);
        if (auth.length < 37 || !same(auth.subarray(0, 32), await rpHash(url))) return refuse("another site's id");
        if (((auth[32] ?? 0) & 0x05) !== 0x05) return refuse("no presence or verification");
        const count = new DataView(auth.buffer, auth.byteOffset + 33, 4).getUint32(0);
        if (count !== 0 && count <= passkey.count) return refuse("a counter that went back");
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(json)));
        const signed = new Uint8Array([...auth, ...hash]);
        const good = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, passkey.key, new Uint8Array(derToRaw(unb64url(body.signature))), signed);
        if (!good) return refuse("a bad signature");
        passkey.count = count;
        events.push("passkey ok");
        return new Response("Signed in with your passkey as alexk.");
      }
      default:
        return null;
    }
  };
}
