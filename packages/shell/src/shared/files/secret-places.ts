/**
 * The one list of what agents never reach in the person's files, whatever
 * the tool: folders that hold secrets or the desktop's own state (listing
 * hides them too), browser profiles (cookies, saved passwords, history), and
 * files whose names say they hold a key or a password. Reading, writing,
 * moving and copying an agent asks for are all refused here (agent-text.ts),
 * and so is waiting for one of them to appear.
 */

import { baseName, isInside } from "./paths.ts";

/** Folders under home whose names, contents, and presence are not an agent's business (listing hides them). */
export const OFF_LIMITS = [
  ".ssh",
  ".gnupg",
  ".password-store",
  ".aws",
  ".kube",
  ".local/share/keyrings",
  ".local/state/dashi",
  ".config/dashi",
  ".config/1Password",
] as const;

/** Browser profiles and other folders whose files are secrets, though their names may be listed. */
export const PROFILE_FOLDERS = [
  ".mozilla",
  ".thunderbird",
  ".config/net.imput.helium",
  ".config/net.imput.helium-headless",
  ".config/chromium",
  ".config/google-chrome",
  ".config/google-chrome-beta",
  ".config/google-chrome-unstable",
  ".config/BraveSoftware",
  ".config/microsoft-edge",
  ".config/vivaldi",
  ".var/app/org.mozilla.firefox",
  ".var/app/com.google.Chrome",
  ".var/app/org.chromium.Chromium",
  ".docker",
  ".config/gh",
  ".config/op",
  ".local/share/fish",
] as const;

/** File names that say they hold a key, a password or a token. */
export const SECRET_NAMES: readonly RegExp[] = [
  /^\.env(\..+)?$/i,
  /^\.envrc$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /\.(pem|key|p12|pfx|kdbx|keystore|jks|gpg|asc|ovpn)$/i,
  /^\.(netrc|pgpass|git-credentials|npmrc|pypirc|htpasswd)$/i,
  /^\.(bash|zsh|python|node_repl|psql|mysql)_history$/i,
  /^(credentials|secrets?)(\.(json|ya?ml|toml|txt))?$/i,
  /^known_hosts$/,
  /^authorized_keys$/,
];

/** Why an agent may not touch `path` (an absolute, normalized path), or null when it may. */
export function secretReason(path: string, home: string): string | null {
  if ([...OFF_LIMITS, ...PROFILE_FOLDERS].some((part) => isInside(`${home}/${part}`, path)))
    return "That folder holds secrets (keys, passwords, a browser's profile) or the desktop's own state, and isn't available to agents.";
  const name = baseName(path);
  if (SECRET_NAMES.some((pattern) => pattern.test(name)))
    return `A file named “${name}” usually holds a key, a password or a token, so agents can't read or change it. Ask the person to open it themselves.`;
  return null;
}
