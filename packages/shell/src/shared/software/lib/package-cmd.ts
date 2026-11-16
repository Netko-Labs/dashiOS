/**
 * The commands for packages and sources, as argument lists: installing and
 * removing an RPM through PackageKit (`pkcon`, its dnf5 backend on Fedora
 * 44; D322), updating some packages by name (Dashi's own row), turning a dnf
 * repository or the Flathub remote on and off. Names and repository ids are
 * checked before they reach a command line, so none can read as an option.
 *
 * PackageKit's polkit rules decide who is asked: installing, removing and
 * changing a repository ask for the password (`auth_admin_keep`); updating
 * from repositories already on does not.
 */

import type { Installation } from "../ids.ts";
import { isPackageName, isRepoId } from "./rpm-query.ts";

function assertName(name: string): string {
  if (!isPackageName(name)) throw new Error(`not a package name: ${String(name).slice(0, 40)}`);
  return name;
}

function assertRepo(id: string): string {
  if (!isRepoId(id)) throw new Error(`not a repository id: ${String(id).slice(0, 40)}`);
  return id;
}

/** `name;version;arch;repo`: PackageKit's id for one package from one repository, so the source the person chose is the one used. */
export function packageId(name: string, evr: string, arch: string, repoId: string): string {
  if (!/^[A-Za-z0-9._:+~^-]{1,80}$/.test(evr) || !/^[a-z0-9_]{1,20}$/.test(arch)) throw new Error("not a package version");
  return `${assertName(name)};${evr};${arch};${assertRepo(repoId)}`;
}

/** Installs one package (by PackageKit id or name); `-p` prints progress, `-y` answers yes (the person already did, on Dashi's sheet). */
export const pkconInstall = (target: string): string[] => ["pkcon", "-p", "-y", "install", target];

export const pkconRemove = (name: string): string[] => ["pkcon", "-p", "-y", "remove", assertName(name)];

/** Updates only these packages (Dashi's own, apart from Fedora's). */
export const pkconUpdateSome = (names: readonly string[]): string[] => ["pkcon", "-p", "-y", "update", ...names.map(assertName)];

export const pkconRepo = (id: string, on: boolean): string[] => ["pkcon", on ? "repo-enable" : "repo-disable", assertRepo(id)];

/** Each installation's remotes with their options (`disabled` when off). */
export const remotes = (): string[] => ["flatpak", "remotes", "--columns=name,options"];

export const flathubToggle = (installation: Installation, on: boolean): string[] => [
  "flatpak",
  "remote-modify",
  `--${installation === "user" ? "user" : "system"}`,
  on ? "--enable" : "--disable",
  "flathub",
];
