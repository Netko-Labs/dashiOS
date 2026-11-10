/**
 * Print: the PDF goes to the desktop's print dialog through xdg-desktop-portal
 * (`org.freedesktop.portal.Print.Print`, the document as a file descriptor),
 * which on Dashi is Dashi's own print sheet (apps/portal/print/), and the
 * person picks the printer, copies and pages there. Without a portal (a
 * development run, another desktop) Preview prints through CUPS itself: it
 * asks first, then sends the file to the default printer with `lp`.
 *
 * The descriptor needs a D-Bus connection that carries file descriptors
 * (FdConnection); it stays open, looked at a few times a second, until the
 * dialog answers, since the portal cancels a request whose asker went away.
 */

import { randomBytes } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { FdConnection, MessageType, type Received, variant } from "../../src/shared/dbus/index.ts";
import { requestPath } from "../../src/shared/portal/file-chooser.ts";
import { runTool } from "./tools.ts";

const PORTAL = "org.freedesktop.portal.Desktop";
const PORTAL_PATH = "/org/freedesktop/portal/desktop";
const PRINT = "org.freedesktop.portal.Print";
const REQUEST = "org.freedesktop.portal.Request";
const BUS = { destination: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus" } as const;
/** How long the print dialog may stay open, and how often the answer is looked for. */
const DIALOG_TIMEOUT_MS = 30 * 60 * 1000;
const LOOK_MS = 200;

export type PrintOutcome = "printed" | "cancelled" | "failed";

/** The portal's answer code as an outcome: 0 printed, 1 cancelled, anything else failed. */
export const outcomeOf = (code: unknown): PrintOutcome => (code === 0 ? "printed" : code === 1 ? "cancelled" : "failed");

/** The match rule for the answer to the request at `handle`. */
export const responseRule = (handle: string): string => `type='signal',sender='${PORTAL}',interface='${REQUEST}',member='Response',path='${handle}'`;

/** The portal's answer among `received`, if it came: the request's Response, or an error reply to the call itself. */
export function answerIn(received: readonly Received[], handle: string, callSerial: number): PrintOutcome | Error | null {
  for (const { message } of received) {
    if (message.type === MessageType.Error && message.replySerial === callSerial) return new Error(String(message.body[0] ?? message.errorName));
    if (message.type === MessageType.Signal && message.interface === REQUEST && message.member === "Response" && message.path === handle) {
      return outcomeOf(message.body[0]);
    }
  }
  return null;
}

/**
 * Hands `pdf` to the portal's print dialog under `title`. Rejects when there
 * is no portal to ask (the caller prints another way).
 */
export async function printWithPortal(
  pdf: string,
  title: string,
  connect: () => Promise<FdConnection> = () => FdConnection.connect({ bus: "session" }),
): Promise<PrintOutcome> {
  const connection = await connect();
  try {
    const token = `dashi_${randomBytes(8).toString("hex")}`;
    const handle = requestPath(connection.uniqueName, token);
    await connection.call({ ...BUS, member: "AddMatch", signature: "s", body: [responseRule(handle)] });
    const fd = openSync(pdf, "r");
    let serial: number;
    try {
      serial = connection.send(
        {
          type: MessageType.MethodCall,
          flags: 0,
          destination: PORTAL,
          path: PORTAL_PATH,
          interface: PRINT,
          member: "Print",
          signature: "ssha{sv}",
          body: [
            "",
            title,
            0,
            new Map([
              ["handle_token", variant("s", token)],
              ["modal", variant("b", true)],
            ]),
          ],
        },
        [fd],
      );
    } finally {
      // The descriptor was copied to the bus as it was sent.
      closeSync(fd);
    }
    const deadline = performance.now() + DIALOG_TIMEOUT_MS;
    while (performance.now() < deadline) {
      const answer = answerIn(connection.drain(), handle, serial);
      if (answer instanceof Error) throw answer;
      if (answer !== null) return answer;
      if (connection.closed) throw new Error("the portal went away");
      await Bun.sleep(LOOK_MS);
    }
    return "cancelled";
  } finally {
    connection.close();
  }
}

/** CUPS's default printer (`lpstat -d`), or null when there is none or no CUPS. */
export async function defaultPrinter(): Promise<string | null> {
  const result = await runTool(["lpstat", "-d"], { timeoutMs: 5000 });
  return result.ok ? parseDefaultPrinter(result.stdout) : null;
}

/** `lpstat -d`'s "system default destination: name", as the name. */
export function parseDefaultPrinter(stdout: string): string | null {
  const name = /destination:\s*(\S+)\s*$/m.exec(stdout)?.[1];
  return name && /^[A-Za-z0-9._@-]{1,127}$/.test(name) ? name : null;
}

/** Print `pdf` on `printer` through CUPS (`lp`); whether CUPS took the job. */
export async function printWithCups(pdf: string, title: string, printer: string): Promise<boolean> {
  if (!pdf.startsWith("/")) return false;
  const result = await runTool(["lp", "-d", printer, "-t", title.slice(0, 200), "--", pdf], { timeoutMs: 30_000 });
  return result.ok;
}
