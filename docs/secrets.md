# Secrets for agents

Dashi's vault: secrets agents can *use* (to sign in, enter a code) but never
*read*. The spec is `docs/0.4.0.html`, "Secrets for agents"; the plan is
milestone 6 in `docs/plan.html`. This is how it is built.

The rule: a secret never enters an agent's context, not as text, a picture,
a file, or an environment variable. Each use is approved on a sheet only the
person can answer, scoped to the task, and logged.

## Pieces

| Piece | Runs as | What it does |
| --- | --- | --- |
| `dashi-secretd` (`crates/dashi-secretd`) | its own system user, `dashi-secret` | Owns the vaults (`/var/lib/dashi-secretd/<uid>.vault`, mode 0600 in a 0700 directory), serves `/run/dashi-secretd/socket`, refuses agents |
| `dashi-secretd-pam` | root, run by `pam_exec` | Hands the login password to dashi-secretd at login; locks the vault when the session ends |
| `dashi-secret-bridge` | you, `dashi-secret-bridge.service` (user unit) | The Secret Service (`org.freedesktop.secrets`) and the portal's Secret backend on the session bus, backed by dashi-secretd; refuses agents too |
| `dashi-agent` (`session/dashi-agent`, `src/agents/sandbox.ts`) | you | Runs an agent in the agent sandbox: a `dashi-agent-*.scope` with bubblewrap |
| the broker (`src/agents/secrets/`) | you, in the shell | Types a password or code into a field it checked, for an agent the person allowed |

## The vault

- **At rest.** A random 256-bit vault key seals the vault's body with
  XChaCha20-Poly1305 (random 192-bit nonces). The vault key is itself sealed
  by a key-wrapping key: Argon2id of the login password (64 MiB, 3 passes,
  a 128-bit salt; the parameters live in the header so they can grow), mixed
  by HKDF-SHA256 with a 256-bit share that only this machine's TPM can unseal
  (`systemd-creds encrypt --with-key=tpm2`), where there is a TPM. Both
  ciphertexts are bound to the owner's uid (the AEAD's associated data). The
  file is JSON: the header in the clear, the rest sealed. Everything is
  RustCrypto (`chacha20poly1305`, `argon2`, `hkdf`, `sha2`); nothing is
  hand-rolled.
- **In memory.** Keys and secrets are zeroed when dropped (`zeroize`) and
  print as `[redacted]`. The service runs with `LimitCORE=0` and the
  hardening in `dashi-secretd.service`; its user is the only one that can
  read its memory.
- **What it holds.** Secret Service collections and items (apps' secrets),
  logins (site, account, password, optional TOTP secret, and whether agents
  may ask for it: Ask or Never), and the portal's per-app secrets.

## Unlocking at login (PAM)

Like gnome-keyring's PAM module, but through `pam_exec`, so there is no C
module to build: the package adds two lines to `/etc/pam.d/greetd` (Dashi's
login screen; `spin/dashi-secretd/usr/share/dashi/pam/dashi-secretd` has them
for any other display manager):

```txt
-auth     optional  pam_exec.so expose_authtok quiet /usr/libexec/dashi/dashi-secretd-pam
-session  optional  pam_exec.so quiet /usr/libexec/dashi/dashi-secretd-pam
```

At `auth`, the helper reads the password (stdin, NUL-terminated) and sends
`unlock {user, password, keyring?}` to dashi-secretd, which opens that
person's vault, or makes it the first time. At `close_session` it sends
`lock {user}`. Both are optional: the vault never fails a login. Only root
may send `unlock`/`lock`, so no program running as you can make your vault
with a password of its choosing.

- **The login keyring, imported once.** On the login that makes the vault
  (and on any later one, until it has been imported), the helper reads
  `~/.local/share/keyrings/login.keyring` (a regular file of the person's,
  not a link; root reads it) and passes it along. dashi-secretd decrypts it
  with the same password (gnome-keyring's format 0: AES-128-CBC under
  iterated SHA-256, an MD5 check) and adds every item, with its attributes,
  to the default collection. The file is left where it was. All of it or
  nothing: a damaged file imports nothing and the login goes on.
- **A changed password.** `change-password {old, new}` re-wraps the same
  vault key. A password changed outside Dashi (`passwd`) leaves the vault
  shut at the next login; it opens with the old one (`unlock-self`).
- **Wrong passwords** (`unlock-self`, `verify`) are slowed: after five in a
  row, every try waits 30 seconds.

## Who may do what

dashi-secretd identifies every connection when it is made: uid and pid from
`SO_PEERCRED`, held by a pidfd (`SO_PEERPIDFD`, else `pidfd_open`) while
`/proc/<pid>/cgroup` is read, then checked to be the same process. Then:

| Caller | May |
| --- | --- |
| in an agent's cgroup (any path element `dashi-agent-…`) | nothing; turned away at the door |
| whose cgroup can't be read | nothing |
| root | `unlock`, `lock` (PAM's) only; root has no vault |
| you (your uid) | everything else, on your own vault only |

The bridge does the same for D-Bus callers: `GetConnectionCredentials`
(`ProcessFD` where the bus has it, else the pid), then the cgroup. Its
portal backend answers only `xdg-desktop-portal` itself (by executable), so
an app can't ask for another app's secret by calling the backend directly.

### The socket protocol

One JSON object per line each way. Requests are `{"op": "<name>", ...}`;
replies `{"ok": true, ...}` or `{"ok": false, "error": "..."}`. Secrets are
base64 (`password`, `secret`, `code`, `totp`), in requests and in the replies
that exist to carry them. Unknown ops and unknown fields are refused.

| Op | Fields | Reply | Who |
| --- | --- | --- | --- |
| `unlock` | `user, password, keyring?` | `created, imported` | root |
| `lock` | `user` | | root |
| `status` | | `exists, unlocked, tpm` | you |
| `unlock-self` | `password` | | you |
| `lock-self` | | | you |
| `verify` | `password` | `verified` | you |
| `change-password` | `old, new` | | you |
| `collections` | | `collections: [{id, label, alias, created, modified}]` | you |
| `create-collection` | `label, alias?` | `id` | you |
| `delete-collection` | `id` | | you |
| `set-alias` | `alias, collection: id\|null` | | you |
| `search` | `attributes?, collection?` | `items: [{id, collection, label, attributes, contentType, created, modified}]` | you |
| `get-secret` | `id` | `secret, contentType` | you |
| `create-item` | `collection, label, attributes, secret, contentType?, replace?` | `id` | you |
| `set-secret` | `id, secret, contentType?` | | you |
| `set-item` | `id, label?, attributes?` | | you |
| `delete-item` | `id` | | you |
| `app-secret` | `appId` | `secret` (64 bytes, made on first use) | you |
| `logins` | `site?` | `logins: [{id, site, account, agents, hasCode, lastUsed}]`, most recently used first; no secret | you |
| `save-login` | `site, account, password, totp?, agents?` | `id` | you |
| `update-login` | `id, account?, password?, totp?, agents?` | | you |
| `delete-login` | `id` | | you |
| `reveal-password` | `id, forAgent?` | `password, site, account`; `forAgent` refuses a "Never" login | you |
| `code` | `id, forAgent?` | `code, site, remaining` (TOTP, RFC 6238, computed here) | you |

## The agent sandbox

An agent is confined when it runs through `dashi-agent` (any program:
`dashi-agent claude`). It gets a systemd scope, `dashi-agent-<name>-<n>.scope`,
and bubblewrap inside it (`src/agents/sandbox.ts`):

- the person's files as they are, but Dashi's settings and the agents'
  grants (`~/.config/dashi`, `~/.local/state/dashi`) read-only, and the
  places that would run something later outside the sandbox (autostart,
  systemd user units, `environment.d`, shell start-up files, desktop
  entries) read-only too;
- `/sys/fs/cgroup` read-only, so it can't move itself out of its scope;
- its own pid namespace and `/proc`: no other process to see, signal, or
  read the memory of (the shell, which types passwords, among them);
- `$XDG_RUNTIME_DIR` replaced by an empty one with only Dashi's MCP socket
  and a filtered session bus (`xdg-dbus-proxy`: notifications and portals;
  not systemd, so no `systemd-run` out of the scope, not the Secret Service,
  not Flatpak): no compositor socket (so no raw `agent-input`), no Wayland or
  X11 display (so no screencopy of its own), no 1Password sockets;
- `/run/dashi-secretd`, the 1Password CLI's configuration and the app's data
  hidden.

Dashi's sign-in tools work only for a confined agent (or one on another
machine, over SSH, whose only view of this one is what MCP returns). An
agent started outside `dashi-agent` is told so.

## What this can't fix

- Once signed in, the agent acts as the person on that site until the
  session ends.
- An agent with DevTools access to a browser (CDP, `--remote-debugging-port`)
  can read field values and cookies; Dashi refuses to fill into a browser
  started that way, but filling is safe only in a browser the agent drives
  through the screen.
- A program outside the sandbox, running as the person, can still use the
  Secret Service (as with gnome-keyring), and could read the shell's memory
  while it types a password; only the vault's own memory is out of reach.
  An agent driving such a program through the screen (a terminal it was
  allowed to type in) sees what that program shows.
- An agent outside `dashi-agent` is not confined at all.
