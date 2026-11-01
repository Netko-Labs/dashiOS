/**
 * AccountsService's values, read strictly: what comes back from the system
 * bus is untrusted until each field has the type it should. And the checks on
 * what goes the other way, a full name and a picture.
 */

import { cleanText } from "../system/text.ts";
import { isPhotoPath } from "../wallpaper/catalog.ts";
import type { Account } from "./types.ts";

/** `PasswordMode`: 0 regular, 1 set at next login, 2 none. */
const PASSWORD_NONE = 2;
/** `AccountType`: 0 standard, 1 administrator. */
const ADMINISTRATOR = 1;

const asNumber = (value: unknown): number | null => {
  const number = typeof value === "bigint" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : null;
};

/** The `org.freedesktop.Accounts.User` properties as an Account; null when the essentials are not there. */
export function parseAccount(properties: ReadonlyMap<string, unknown>): Account | null {
  const uid = asNumber(properties.get("Uid"));
  const userName = properties.get("UserName");
  if (uid === null || typeof userName !== "string" || userName === "") return null;
  const realName = properties.get("RealName");
  const icon = properties.get("IconFile");
  const type = asNumber(properties.get("AccountType"));
  const passwordMode = asNumber(properties.get("PasswordMode"));
  return {
    uid,
    userName: cleanText(userName),
    realName: typeof realName === "string" ? cleanText(realName) : "",
    iconFile: typeof icon === "string" && icon.startsWith("/") ? icon : null,
    automaticLogin: properties.get("AutomaticLogin") === true,
    administrator: type === ADMINISTRATOR,
    hasPassword: passwordMode !== PASSWORD_NONE,
  };
}

/** The longest full name accepted. */
export const MAX_NAME = 120;

/** Why a full name cannot be used, or null. The GECOS field it ends up in has `:` `,` `=` for separators and one line. */
export function nameProblem(name: string): string | null {
  const text = name.trim();
  if (text === "") return "Enter your name.";
  if (text.length > MAX_NAME) return `The name can have up to ${MAX_NAME} characters.`;
  if (/[\p{Cc}:,=]/u.test(text)) return "The name can't have colons, commas, equals signs, or line breaks.";
  return null;
}

/** AccountsService refuses pictures over this size. */
export const MAX_ICON_BYTES = 1_048_576;

/** Why a picture cannot be used, or null: an absolute PNG or JPEG path no larger than AccountsService takes. */
export function iconProblem(path: string, size: number | null): string | null {
  if (!isPhotoPath(path) || !/\.(?:png|jpe?g)$/i.test(path)) return "Choose a PNG or JPEG picture.";
  if (size !== null && size > MAX_ICON_BYTES) return "That picture is over 1 MB. Choose a smaller one.";
  return null;
}

/** The initials for a picture-less avatar: up to two letters of the name, else of the login. */
export function initialsOf(account: Pick<Account, "realName" | "userName">): string {
  const words = (account.realName.trim() || account.userName).split(/\s+/).filter((word) => word !== "");
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]];
  return letters.map((word) => [...(word ?? "")][0] ?? "").join("").toUpperCase();
}
