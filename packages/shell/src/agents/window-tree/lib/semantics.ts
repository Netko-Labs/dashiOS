/**
 * What an element means beyond its role: a secret (never read), the primary
 * action of a sheet or dialog, a destructive one (it deletes, sends or pays:
 * the assistant's spoken yes, D149 and D221), a modal sheet. The toolkit's
 * word first (AT-SPI's IS_DEFAULT and MODAL states, a `destructive`
 * attribute); where it has none, Dashi's own rules on names, in English and
 * Spanish, for the few cases that decide consent.
 */

import type { Element } from "../types.ts";
import { DIALOGS, FIELDS, has, R, S } from "./roles.ts";

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

/** Words on a button that delete, send or pay. A sheet's default button that says one is destructive. */
const DESTRUCTIVE_NAME =
  /^(delete|remove|erase|discard|empty( trash)?|move to trash|trash|clear|reset|forget|uninstall|sign out|log out|quit|send|submit|pay|buy|purchase|confirm|eliminar|borrar|quitar|descartar|vaciar|enviar|pagar|comprar|confirmar|cerrar sesión|desinstalar|olvidar)\b/i;

export function isPrimary(element: Element): boolean {
  return has(element.states, S.IS_DEFAULT) || element.attributes["dashi-primary"] === "true";
}

/**
 * Whether acting on it is destructive: the toolkit says so, or it is the
 * default button of a dialog or sheet (`inSheet`) and its name deletes,
 * sends or pays. A button named "Delete" in a window's toolbar opens its
 * own sheet in Dashi's apps; that sheet's default is the destructive one.
 */
export function isDestructive(element: Element, inSheet: boolean): boolean {
  const said = element.attributes.destructive === "true" || element.attributes["dashi-destructive"] === "true";
  if (said) return true;
  if (!DESTRUCTIVE_NAME.test(element.name.trim())) return false;
  return inSheet || isPrimary(element);
}

/** A sheet or dialog that holds the window's keyboard until answered. */
export function isModal(element: Element): boolean {
  return has(element.states, S.MODAL) || (DIALOGS.has(element.role) && element.role !== R.FILE_CHOOSER);
}
