/**
 * What an element means beyond its role: a secret (never read), the primary
 * action of a sheet or dialog, a critical one (it pays, signs in with a
 * secret, loses work for good, changes the system or sends as the person),
 * a modal sheet. The toolkit's word first (AT-SPI's IS_DEFAULT and MODAL
 * states, a `critical` or `destructive` attribute); where it has none, the
 * button's role and words, in English and Spanish.
 */

import { CRITICAL_KINDS, type Critical } from "../../consent.ts";
import type { Element } from "../types.ts";
import { FIELDS, has, R, S } from "./roles.ts";

/** Names that say a field holds a password, a code or a card (as the web reader's rules: browser-extension/src/page/node.ts). */
const SECRET_NAME =
  /pass(word|phrase|code)|contraseña|clave|\bpin\b|one[- ]?time|\botp\b|2fa|verification code|código|cvv|cvc|card number|número de (la )?tarjeta/i;

/** A field whose contents are never read: a password field, or one named as a secret. */
export function isSecret(element: Pick<Element, "role" | "name" | "description" | "attributes">): boolean {
  if (element.role === R.PASSWORD_TEXT) return true;
  if (!FIELDS.has(element.role) || element.role === R.TERMINAL) return false;
  const hint = `${element.name} ${element.description} ${element.attributes["placeholder-text"] ?? ""}`;
  return SECRET_NAME.test(hint) || element.attributes.secret === "true";
}

/**
 * What pressing an element would do that the owner's consent rule calls
 * critical (briefs/consent-critical-only.md): pay, sign in with a saved
 * secret, lose work for good, change the system, or send something to
 * someone as the person: the kinds of the one critical list (agents/
 * consent.ts `CRITICAL`, D260). These are flags; asking is the consent
 * rule's (`TreesRun.yes` → `Scopes.criticalYes`, its sheet or launcher line).
 */

/** What around an element decides it: inside a sheet or dialog, and whether a password field near it is filled. */
export interface Hints {
  inSheet: boolean;
  secretFilled: boolean;
}

/**
 * A button's words, at the start of its name, English and Spanish. No toolkit
 * measured says any of this (GTK's `destructive-action` style and Qt's
 * DestructiveRole are not published on AT-SPI; Metal has no field for it:
 * for-mirin.md), so the words decide, the toolkit's own attribute first.
 */
const WORDS: ReadonlyArray<[Critical, RegExp]> = [
  [
    "pays",
    /^(pay|buy|purchase|place (your )?order|check ?out|complete (the )?purchase|subscribe|pagar|comprar|realizar (el )?pedido|finalizar compra|suscribirse)(?=$|\s)/i,
  ],
  [
    "loses work",
    /^(don'?t save|do not save|close without saving|discard( changes| all)?|revert|delete (permanently|immediately|forever)|permanently delete|empty( the)?( trash| bin)?|erase|format|wipe|no guardar|cerrar sin guardar|descartar|eliminar (permanentemente|definitivamente|para siempre)|vaciar( la)?( papelera)?|borrar (todo|definitivamente)|formatear)(?=$|\s)/i,
  ],
  ["system", /^(install|uninstall|update( all)?|upgrade|restart and update|authenticate|instalar|desinstalar|actualizar( todo)?|autenticar)(?=$|\s)/i],
  ["sends", /^(send|post|publish|reply( all)?|submit|accept|decline|enviar|publicar|responder|aceptar|rechazar)(?=$|\s)/i],
];

const SIGN_IN = /^(sign in|log ?in|unlock|continue|iniciar sesi[oó]n|ingresar|entrar|desbloquear|continuar)(?=$|\s)/i;
/** A command is a few words; a longer name is a row or a document ("install.err Nov 2 …"), never a command. */
const COMMAND_CHARS = 40;

/** Whether pressing it is critical, and why; null when it just runs. Only what can be pressed is asked about. */
export function criticalOf(element: Element, hints: Hints): Critical | null {
  const said = element.attributes.critical ?? element.attributes["dashi-critical"];
  const told = CRITICAL_KINDS.find((kind) => kind === said);
  if (told) return told;
  if (element.attributes.destructive === "true") return "loses work";
  const name = element.name.trim();
  if (!name || name.length > COMMAND_CHARS || FIELDS.has(element.role)) return null;
  for (const [kind, words] of WORDS) if (words.test(name)) return kind;
  return hints.secretFilled && SIGN_IN.test(name) ? "secret" : null;
}

/** Whether a tree holds a filled secret field (what makes its "Sign in" a sign-in with a secret). */
export function holdsFilledSecret(root: Element): boolean {
  return (isSecret(root) && (root.chars ?? 0) > 0) || root.children.some(holdsFilledSecret);
}

/** The primary action of its view, where the toolkit says (AT-SPI's IS_DEFAULT). */
export function isPrimary(element: Element): boolean {
  return has(element.states, S.IS_DEFAULT) || element.attributes["dashi-primary"] === "true";
}

/** A sheet or dialog that holds the window's keyboard until answered. */
export function isModal(element: Element): boolean {
  return has(element.states, S.MODAL) || element.role === R.DIALOG;
}
