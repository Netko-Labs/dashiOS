/**
 * The portal's Email (org.freedesktop.impl.portal.Email): "Send by email"
 * opens the default mail app with the draft filled in. No sheet: the mail
 * app's own window is the confirmation. The draft goes as a `mailto:` link
 * (RFC 6068) to whatever handles mailto; Thunderbird, which ignores
 * attachments in links, gets its own `-compose` line instead.
 *
 *   ComposeEmail(o handle, s app_id, s window, a{sv} options) → (u, a{sv})
 *   options: address s, addresses as, cc as, bcc as, subject s, body s, attachments as
 */

import type { InterfaceSpec } from "../../src/dbus/index.ts";
import { type Exec, exec } from "../files/exec.ts";
import { fileUri } from "../files/uri.ts";
import { parseGioDefault } from "./app-chooser/choices.ts";
import { type Requests, Response, type ResponseCode } from "./request.ts";
import { str, strings, vardict } from "./vardict.ts";

export const EMAIL = "org.freedesktop.impl.portal.Email";

export interface Draft {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  /** Absolute paths. */
  attachments: string[];
}

/** An address the way a mail link may carry it: something@somewhere, nothing that could break the link. */
const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+$/;

const addresses = (list: readonly string[]): string[] => [...new Set(list.map((a) => a.trim()).filter((a) => ADDRESS.test(a)))].slice(0, 100);

function attachmentPath(value: string): string | null {
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "file:" ? decodeURIComponent(url.pathname) : null;
  } catch {
    return null;
  }
}

export function parseDraft(options: unknown): Draft {
  const dict = vardict(options);
  const one = str(dict, "address");
  return {
    to: addresses([...(one ? [one] : []), ...(strings(dict, "addresses") ?? [])]),
    cc: addresses(strings(dict, "cc") ?? []),
    bcc: addresses(strings(dict, "bcc") ?? []),
    subject: (str(dict, "subject") ?? "").replace(/[\r\n]+/g, " "),
    body: str(dict, "body") ?? "",
    attachments: (strings(dict, "attachments") ?? []).flatMap((value) => attachmentPath(value) ?? []).slice(0, 50),
  };
}

/** The draft as a `mailto:` link: recipients in the path, the rest as query fields, all percent-encoded. */
export function mailtoUri(draft: Draft): string {
  const fields: string[] = [];
  const add = (key: string, value: string) => fields.push(`${key}=${encodeURIComponent(value)}`);
  if (draft.cc.length > 0) add("cc", draft.cc.join(","));
  if (draft.bcc.length > 0) add("bcc", draft.bcc.join(","));
  if (draft.subject) add("subject", draft.subject);
  if (draft.body) add("body", draft.body.replace(/\r?\n/g, "\r\n"));
  for (const path of draft.attachments) add("attach", path);
  const to = draft.to.map((address) => encodeURIComponent(address).replace(/%40/g, "@")).join(",");
  return `mailto:${to}${fields.length > 0 ? `?${fields.join("&")}` : ""}`;
}

/** Thunderbird's `-compose` argument: `key='value'` pairs, its own quoting (a `'` in a value can't be said, so it is dropped). */
export function thunderbirdCompose(draft: Draft): string {
  const quote = (value: string) => `'${value.replace(/'/g, "")}'`;
  const parts = [
    draft.to.length > 0 ? `to=${quote(draft.to.join(","))}` : null,
    draft.cc.length > 0 ? `cc=${quote(draft.cc.join(","))}` : null,
    draft.bcc.length > 0 ? `bcc=${quote(draft.bcc.join(","))}` : null,
    draft.subject ? `subject=${quote(draft.subject)}` : null,
    draft.body ? `body=${quote(draft.body)}` : null,
    draft.attachments.length > 0 ? `attachment=${quote(draft.attachments.map(fileUri).join(","))}` : null,
  ];
  return parts.filter((part) => part !== null).join(",");
}

/** Starts a program that may stay (a mail app): not waited for, not tied to this process. */
export function launchDetached(command: readonly string[]): boolean {
  try {
    Bun.spawn([...command], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

/** Opens the draft in the default mail app. Whether it could. */
export async function composeEmail(draft: Draft, run: Exec = exec, launch: (command: readonly string[]) => boolean = launchDetached): Promise<boolean> {
  const handler = await run(["gio", "mime", "x-scheme-handler/mailto"]);
  const id = handler.ok ? parseGioDefault(handler.stdout) : null;
  const thunderbird = Bun.which("thunderbird");
  if (id && /thunderbird/i.test(id) && thunderbird) return launch([thunderbird, "-compose", thunderbirdCompose(draft)]);
  return (await run(["gio", "open", mailtoUri(draft)])).ok;
}

export function emailInterface(requests: Requests, compose: (draft: Draft) => Promise<boolean> = composeEmail): InterfaceSpec {
  return {
    name: EMAIL,
    methods: {
      ComposeEmail: {
        in: "ossa{sv}",
        out: "ua{sv}",
        handler: ([handle, , , options]) =>
          requests.run(
            handle,
            async (): Promise<[ResponseCode, Map<string, unknown>]> => [(await compose(parseDraft(options))) ? Response.success : Response.other, new Map()],
          ),
      },
    },
    properties: { version: { type: "u", get: () => 3 } },
  };
}
