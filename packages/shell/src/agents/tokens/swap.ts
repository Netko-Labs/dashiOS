/**
 * The token proxy's decisions, pure (docs/secrets.md, "Tokens that stay
 * home"): which hosts a token is for, what a CONNECT asks for, and the swap
 * itself, where a placeholder (`dashi:github`) in one of the headers a token
 * item names becomes that header with the real token (an item may name
 * several: Anthropic's SDKs send `x-api-key` or `Authorization: Bearer`).
 * A header the request didn't send is never added. Nothing here touches a
 * socket or the vault.
 */

import { timingSafeEqual } from "node:crypto";

export const PLACEHOLDER_PREFIX = "dashi:";
export const DEFAULT_HEADER = "Authorization: Bearer {}";

/** What an agent holds instead of the token. */
export const placeholder = (name: string): string => `${PLACEHOLDER_PREFIX}${name}`;

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** A host name as dashi-secretd lists it: lowercase, no trailing dot, two labels or more. */
export function isHostName(host: string): boolean {
  const labels = host.split(".");
  return host.length <= 253 && labels.length >= 2 && labels.every((label) => LABEL.test(label));
}

/**
 * Whether a request to `host` may carry a token listed for `hosts`: the same
 * host, or one under a "*." entry; never the parent, a look-alike, or a
 * suffix that isn't a whole label. dashi-secretd checks again before it
 * hands the token out (`host_listed` in daemon/tokens.rs).
 */
export function hostListed(hosts: readonly string[], host: string): boolean {
  const name = host.trim().replace(/\.$/, "").toLowerCase();
  if (!isHostName(name)) return false;
  return hosts.some((listed) => (listed.startsWith("*.") ? name.endsWith(listed.slice(1)) : listed === name));
}

/** "Authorization: Bearer {}" as the header's name (lowercase) and its value's template. */
export function parseHeaderSpec(spec: string): { name: string; template: string } | null {
  const colon = spec.indexOf(":");
  if (colon < 1) return null;
  const name = spec.slice(0, colon).trim().toLowerCase();
  const template = spec.slice(colon + 1).trim();
  if (!/^[a-z0-9-]{1,64}$/.test(name) || template.split("{}").length !== 2) return null;
  return { name, template };
}

// --- CONNECT ----------------------------------------------------------------

/** The most a CONNECT's head may be. */
export const MAX_HEAD = 8 * 1024;

export type ConnectHead = { host: string; port: number; auth: string | null } | { error: number; reason: string };

/** A proxy request's head ("CONNECT host:443 HTTP/1.1", headers, a blank line): where to, and its credentials. */
export function parseConnect(head: string): ConnectHead {
  const lines = head.split("\r\n");
  const [method, target, version] = (lines[0] ?? "").split(" ");
  if (method !== "CONNECT" || !target || !version?.startsWith("HTTP/1.")) return { error: 405, reason: "Only CONNECT (HTTPS) goes through this proxy" };
  const at = target.lastIndexOf(":");
  const host = target
    .slice(0, at)
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  const port = Number(target.slice(at + 1));
  if (at < 1 || !host || !Number.isInteger(port) || port < 1 || port > 65_535 || /[\s/@]/.test(host)) return { error: 400, reason: "Bad CONNECT target" };
  const credentials = lines
    .slice(1)
    .map((line) => line.match(/^proxy-authorization:\s*(.*)$/i)?.[1]?.trim())
    .find((value) => value !== undefined);
  return { host, port, auth: credentials ?? null };
}

/** The Proxy-Authorization a sandbox's clients send: `dashi:<key>` in Basic, from HTTPS_PROXY's user and password. */
export const proxyCredentials = (key: string): string => `Basic ${Buffer.from(`dashi:${key}`).toString("base64")}`;

/** Whether a CONNECT's credentials are this sandbox's, compared in constant time. */
export function authorized(auth: string | null, key: string): boolean {
  if (auth === null) return false;
  const want = Buffer.from(proxyCredentials(key));
  const got = Buffer.from(auth);
  return got.length === want.length && timingSafeEqual(got, want);
}

// --- The swap ---------------------------------------------------------------

/** A token item for this host, as listed (no token). */
export interface Candidate {
  name: string;
  /** The headers it may go in ("x-api-key: {}", "Authorization: Bearer {}"). */
  headers: readonly string[];
}

/** Headers that are the connection's, never forwarded (RFC 9110, 7.6.1), and the proxy's own. */
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authorization",
  "proxy-authenticate",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/** The request's headers without the connection's own, ready to go upstream. */
export function forwardHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const name of HOP_BY_HOP) out.delete(name);
  for (const name of (headers.get("connection") ?? "").split(",")) if (name.trim()) out.delete(name.trim());
  return out;
}

/** `dashi:<name>` as a whole word: `dashi:git` isn't in `dashi:github`. */
function marker(name: string): RegExp {
  return new RegExp(`${placeholder(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9._-])`, "g");
}

const basicOf = (value: string): string | undefined => value.match(/^basic\s+([A-Za-z0-9+/=]+)$/i)?.[1];

/** Whether a header's value holds token `name`'s placeholder, as it is or inside Basic credentials (git's way). */
function holds(value: string, name: string): boolean {
  if (marker(name).test(value)) return true;
  const basic = basicOf(value);
  return basic !== undefined && marker(name).test(Buffer.from(basic, "base64").toString("latin1"));
}

/** The headers of `specs` the request sent with token `name`'s placeholder in them, parsed. */
function carrying(headers: Headers, name: string, specs: readonly string[]): Array<{ name: string; template: string; value: string }> {
  return specs.flatMap((each) => {
    const spec = parseHeaderSpec(each);
    const value = spec ? headers.get(spec.name) : null;
    return spec && value !== null && holds(value, name) ? [{ ...spec, value }] : [];
  });
}

/** The token items whose placeholder is in one of the headers they name: only these are asked of the vault. */
export function wanted(headers: Headers, candidates: readonly Candidate[]): Candidate[] {
  return candidates.filter((candidate) => carrying(headers, candidate.name, candidate.headers).length > 0);
}

/**
 * The header with the token in it. Its value becomes the item's template
 * with `{}` as the token, so its shape is the person's, not the agent's;
 * credentials in Basic (`x-access-token:dashi:github`, as git sends them)
 * get the token in the placeholder's place and are encoded again.
 */
export function swapped(value: string, name: string, template: string, token: string): string {
  const basic = basicOf(value);
  if (!marker(name).test(value) && basic !== undefined) {
    const decoded = Buffer.from(basic, "base64").toString("latin1");
    return `Basic ${Buffer.from(
      decoded.replace(marker(name), () => token),
      "latin1",
    ).toString("base64")}`;
  }
  return template.replace("{}", () => token);
}

/**
 * Put each token in whichever of its headers the request sent with its
 * placeholder; `tokens` maps a name to its token and header specs, from the
 * vault. A header that wasn't sent is never added.
 */
export function swapHeaders(headers: Headers, tokens: ReadonlyMap<string, { token: string; headers: readonly string[] }>): Headers {
  const out = new Headers(headers);
  for (const [name, { token, headers: specs }] of tokens) {
    for (const spec of carrying(out, name, specs)) out.set(spec.name, swapped(spec.value, name, spec.template, token));
  }
  return out;
}
