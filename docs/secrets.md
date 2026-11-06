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

## Blanked captures

The shell decides what agents' pictures blank; dashi-comp paints it
(`capture-mask`, `docs/compositor-ipc.md`), like Android's FLAG_SECURE but
only for agents: the person's own screenshots and screen sharing are
unchanged. Before every agent screenshot, every still of a recording, and
every 400 ms while an agent's recording runs, `src/agents/mask.ts` sets the
`agent` mask to:

- every consent sheet (the `dashi.agent-consent` layer);
- the vault's windows (Settings while its Passwords pane shows);
- windows handed to the person ("Your turn") until they press Done;
- every password field that is showing (AT-SPI, role `PASSWORD_TEXT`, state
  `SHOWING`), 8 points larger all round, in each window of the app that has it.
- every field Dashi typed a code or a card into, for ten minutes at most:
  found again through AT-SPI before each picture, so the blank follows it
  as the page scrolls, leaves while it is hidden (another tab), and goes
  with its page; a field not found within 300 ms is blanked where it was.
  A page is gone when its app forgets its node (Firefox) or when it is no
  longer among its parent's children (Chromium keeps the old page's nodes
  answering, as they were, after the tab moved on);
- what an app shows back after Dashi typed a card or a password into one of
  its windows (`src/agents/fill-prompts.ts`): Firefox's "Securely save this
  card? •••• 4242 12/34" and "Save password?" (with its Show button) are
  xdg_popups of the window. From the fill until a minute after its fields
  were last seen, that window's popups are blanked, and dashi-comp keeps
  each popup blanked for as long as it lives (a prompt left open is never
  shown); every window of the same app that opened since the fill is blanked
  whole while it lives. Popups opened after that minute (menus) are the
  agent's to see again. A password Dashi types counts as a filled field too,
  so a page's "show password" can't show it.

A field's blank stops where an opaque window in front covers it (its
declared opaque region, less its rounded corners), so a field in a window
behind isn't a dark box over the one in front; while windows move
(the overview, a slide, a flight) nothing is clipped.

A sheet waiting for the person doesn't hold the agent's pictures: it is
blanked in them like the rest, so a screenshot taken meanwhile returns at
once.

Chromium (Chrome, Helium, Electron apps) builds its web pages' accessibility
tree only once an assistive tool asks for more than the window's frame. So
before it looks, the shell wakes each app once (`Atspi.wake` in
`src/agents/atspi/client.ts`): it asks the app and its windows, then its
web documents, for their attributes, which turns on Chromium's web tree
(`--force-renderer-accessibility` isn't needed); `org.a11y.Status.IsEnabled`
alone gives only the frame. Firefox publishes its tree at once, but answers
a node's first `GetExtents` with nothing, so that is asked twice. Chromium
also reports AT-SPI's window coordinates in device pixels from an origin of
its own, so a web field is placed by its page (the outermost web document):
the page fills the window's content below the toolbar with equal borders at
left, right and bottom, and page width over content width is the scale
(`toWindow` in `src/agents/atspi/tree.ts`).

Captures name the mask (`capture {mask: "agent"}`). An agent's recording is
a wf-recorder the shell starts gated: a shell that waits for a line, then
`exec`s wf-recorder with the same pid, so the pid is in the mask before the
first frame is copied. If the mask can't be set, the screenshot or the
recording is refused. A field AT-SPI doesn't report isn't blanked. The
blanks follow a window where it is drawn: small in the overview, flying to
the Dock, sliding with its Space; a live picture of a blanked window (the
switcher's, a Desktop's in Mission Control) is blanked whole.

## Consent from the person only

`agent-input` may borrow the person's seat, so a click on a sheet doesn't
say whose it was. dashi-comp notes each button and key press against what
received it, a layer by namespace or a window by id, as the person's
(libinput) or an agent's (`agent-input`), and answers `input-origin`. A
consent sheet's yes counts only if the person pressed on the sheet within the
last 2 seconds and no agent pressed there since (`src/agents/person.ts`); a
no always counts. Anything else (an older compositor, an error) is a no.

A press goes to what is under the pointer at that moment, even when it
appeared under a still pointer (a code's sheet where the sign-in's sheet
was): dashi-comp enters that surface before the press, so the press it
counts as the sheet's is the one the sheet gets.

Sheets are solid (the launcher's glass without its alpha), so the page under
a question can't be read through it. The scope sheet fits a 1280×720-point
screen; its permissions list scrolls.

An agent that gives up on a call (MCP's `notifications/cancelled`, sent on
a client's timeout) gets no reply to it; a sheet or "Your turn" it was
waiting on comes down at once, and that is no refusal: the next call asks
again. Nothing is typed for a call given up on, even if the person answered
just before. An agent that disconnects has all its sheets taken down.

## Signing in, codes, "Your turn"

Agent tools (`src/agents/tools/secrets.ts`), carried out by
`src/agents/desktop/secrets.ts` and the broker (`src/agents/secrets/broker.ts`):

| Tool | Scope | What it does |
| --- | --- | --- |
| `list_logins {site?}` | Sign in for you | Each saved login's site, account, source, whether it has a code, and whether agents may ask (`ask`/`never`). Never a secret |
| `pay {window, site, amount, card?}` | Pay for you | Fills a saved card after dashi-secretd asked the person (finger or password), within the limits (below) |
| `sign_in {window, site, account?, submit?}` | Sign in for you | Asks the person which login (the sheet lists every enabled source's, most recently used first, with where each is saved), then types the account (if the user name field is focused), Tab, and the password |
| `fill_code {window, site, account?, submit?}` | Sign in for you | Types the login's current TOTP code |
| `hand_over {window, reason}` | Manage windows and apps | "Your turn: <reason>", Done; the agent waits, the window is blank in its pictures |

"Sign in for you" is a scope like the others, but every login is asked about
again on its own sheet ("Claude wants to sign in to github.com as alexk":
Deny, Allow for This Task, Allow Once). "Allow for This Task" lasts while the
agent stays connected; "Allow Once" covers that sign-in and, for two
minutes, its one-time code. A login marked Never is refused, by the broker
and by dashi-secretd itself (`forAgent`).

Before the sheet and again just before typing, the broker checks the field
(`src/agents/secrets/field-check.ts`):

- AT-SPI says the focused field is a password field (`PASSWORD_TEXT`; for a
  code, an editable text or password field). The focus comes from AT-SPI
  focus events (`object:state-changed:focused`), else a bounded search;
- every web document around the field, frames included, is on the login's
  site (the same host or one under it), over https (http only on
  `*.localhost`), by the documents' `DocURL`;
- the browser wasn't started with remote debugging (CDP, Marionette).

The secret is fetched only then, typed through the agent's hands (one
`agent-input` request), and dropped; the typing runs alone, so the agent's own
input can't move the focus meanwhile (only the typing: the agent's other
calls go on while a sheet waits for the person). Results say what was typed for whom,
never what. Agents outside the sandbox (`dashi-agent`) are refused, and told
how to get in.

"Your turn" (`hand_over`): a banner at the top ("Your turn: sign in to the
bank", Done; one overlay, no bar), the window comes forward, the agent's
other calls wait, and the window is blank in its pictures until the person
presses Done (their own press, as for sheets).

## Sources

Dashi's vault and 1Password, each turned on in Settings › Passwords
(`$XDG_CONFIG_HOME/dashi/passwords.json`: `sources`, `saveTo`; read-only in the
sandbox). The broker asks each enabled one for logins matching the site
(`src/agents/secrets/sources.ts`); a source that fails is left out and named.
Dashi's vault always holds the Secret Service's items (apps' secrets).

### 1Password

`src/agents/secrets/onepassword.ts`, through the `op` CLI's desktop app
integration (1Password › Settings › Developer › "Integrate with 1Password
CLI"): `op` asks the 1Password app, which asks the person to unlock it.
The shell is the broker: it runs as the person, outside every agent sandbox
(which hides 1Password's sockets, the CLI's configuration, and the app's
data), and:

- lists `op item list --categories Login --format json` (no secrets: ids,
  vaults, the username, URLs, tags), kept five minutes;
- for one approved use, reads that one item's one field:
  `op read --no-newline op://<vault>/<item>/password`, or
  `op item get <item> --vault <vault> --otp` for the code; types it, drops it;
- saves a new login (Settings, "Save new logins to 1Password") as a JSON
  template on `op item create -`'s stdin, never on a command line.

Items tagged `dashi-never` are "Never" for agents. The CLI doesn't say when
an item was last used, so Dashi notes its own uses
(`~/.local/state/dashi/agents/logins-used.json`, ids and times only) for the
sheet's order. It doesn't say whether an item has a code either: `fill_code`
finds out. Not checked on a machine with 1Password yet (the plan's open
question): no service account is needed, and each `op` call may prompt.

Settings › Passwords also lists the vault's logins (site, account, Ask or
Never for agents, Delete) and adds new ones (site, account, password,
two-factor setup key). Agents' pictures blank Settings while it shows.

## Passkeys

dashi-secretd makes a virtual FIDO2 security key itself (`src/fido/`), so
every browser sees a USB key and needs no extension:

- **The device** (`uhid.rs`): `/dev/uhid`, which a udev rule
  (`70-dashi-secretd-uhid.rules`) gives the `dashi-secret` user alone
  (`uhid` is loaded at boot by `modules-load.d`); a HID device with FIDO's
  usage page (0xF1D0), 64-byte reports. systemd's `fido_id` tags its hidraw
  node, and the person's browser gets it (uaccess).
- **CTAPHID** (`ctaphid.rs`): INIT (a channel per browser), PING, WINK,
  CBOR, CANCEL; KEEPALIVE every 100 ms while the person is asked; no U2F.
- **CTAP2** (`ctap2.rs`): `authenticatorGetInfo` (FIDO_2_0, resident keys,
  built-in user verification, ES256), `authenticatorMakeCredential` ("none"
  attestation, AAGUID `dashi-vault-key1`) and `authenticatorGetAssertion`.
  No PIN (`PIN_NOT_SET`, `PIN_AUTH_INVALID`). Every passkey is resident,
  P-256, and kept in the vault of the person at the screen; its private key
  never leaves `store.rs`, only signatures do, over the site's id hash, so
  a passkey works for its own site only. The counter grows with each use.
- **Every use asks**, whoever started it, and needs the fingerprint or the
  password (below). Not checked with a browser yet: the VM checks do that.

## Asking the person

A passkey made or used (and, later, a payment) is a question dashi-secretd
asks (`src/fido/approval.rs`): the shell keeps a connection open
(`watch-approvals`) and gets `{"event": "approve", id, kind, rp, user}`; it
shows the sheet (`src/approval-sheet.tsx`, on the consent sheets' layer, so
agents' pictures blank it). A yes must be proven:

- **the fingerprint**: dashi-secretd itself asks fprintd (`fprint.rs`;
  its polkit rule lets the `dashi-secret` user verify, never enroll) as the
  question opens, and a match answers it;
- **the password**: `approve {id, password}`, checked against the vault
  (and slowed after wrong tries like every password).

`deny {id}` needs no proof. Only the question's owner (uid) can answer it,
never an agent's cgroup; no answer in a minute is a no.

| Op | Fields | Reply |
| --- | --- | --- |
| `watch-approvals` | | `{}`, then events on the same connection |
| `approve` | `id, password` | |
| `deny` | `id` | |
| `passkeys` | | `passkeys: [{id, rpId, userName, created, lastUsed}]` |
| `delete-passkey` | `id` | |

## Payments

`pay {window, site, amount, card?}` (`src/agents/secrets/pay.ts`), behind
a scope of its own, "Pay for you", which "Always Allow" never keeps
(`NEVER_KEPT` in `consent.ts`; a kept one in `grants.json` is ignored too).
The clipboard history's scope, "See your clipboard history"
(`read_clipboard_history`, docs/actions.md "Scopes"), is never kept either,
and each call asks the person; copies from password fields, password
managers and the vault were never kept in the history to begin with.

- **Cards** live in the vault (`save-card`: a Luhn-valid number, MM/YY, a 3
  or 4 digit code, "single use" or not; `cards` lists them by their last
  four digits only). A single-use virtual card (from the issuer's app) is
  refused once used, and is chosen first.
- **Limits** live in the vault too, where no agent can reach them: per
  payment and per month (the last 30 days), $100 and $300 until the person
  changes them in Settings › Passwords, which needs the login password
  (`set-limits`); never above $10,000 a payment.
- **Each payment** is `pay {merchant, cents, card}` to dashi-secretd: within
  the limits, asked of the person ("Pay signin.localhost $4.20?", the
  fingerprint or the password, as for passkeys), then noted and the card
  handed to the broker (its number and code as one secret).
- **Filling**: the focused field must be an editable field on a page of the
  site (as for logins); the broker types the number, Tab, the expiry, Tab,
  the code, checking the page at each field. Card fields aren't password
  fields, so each one Dashi types into is added to the agents' mask (so are
  one-time code fields; see "Blanked captures"). The agent presses the page's own
  pay button.

| Op | Fields | Reply |
| --- | --- | --- |
| `cards` | | `cards: [{id, label, last4, expiry, singleUse, used}]` |
| `save-card` | `label, number, expiry, cvc, singleUse` | `id` |
| `delete-card` | `id` | |
| `spending` | | `perPayment, perMonth, spentThisMonth` (cents) |
| `set-limits` | `perPayment, perMonth, password` | |
| `pay` | `merchant, cents, card` | `card` (number, newline, code), `expiry` |

Fields that follow each other in another order (a code before the expiry,
fields in iframes from a payment provider) are refused by the page check or
filled wrongly: the broker doesn't guess. A payment the person allowed is
counted even if the page changed before the card was typed.

Payment-provider tokens (Stripe shared payment tokens, Visa Intelligent
Commerce, Mastercard Agent Pay) were considered and dropped: agents pay
with cards only.

## Tokens that stay home (designed, not built)

For an agent's commands and MCP servers: they hold placeholders
(`dashi:github`), and a proxy swaps in the real API token only for the hosts
the token is for. The design, for a later stream:

- **Token items** in the vault: `{name, hosts, header}` (`header`: where the
  token goes, `Authorization: Bearer {}` by default); `token {name, host}`
  answers only for a listed host.
- **The proxy** is the shell's (it is the broker, outside every sandbox;
  dashi-secretd refuses anything in an agent's scope). `dashi-agent` binds
  its socket into the sandbox and sets `HTTPS_PROXY`; for a listed host the
  proxy terminates TLS with a leaf certificate from a CA made for that
  sandbox alone (`SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`,
  `GIT_SSL_CAINFO` point at the system's CAs plus it, inside the sandbox
  only), replaces a placeholder in the header named, and forwards over TLS
  it verifies itself. Other hosts are tunneled untouched: a placeholder sent
  there is worthless. Tools that pin certificates break, as the spec says.

## The test site

`packages/shell/test/fixtures/sign-in-site/server.ts` (a small Bun server):
a login (`alexk`, a password of the fixture's), a TOTP code, passkeys, and a
fake checkout that takes Stripe's test card number only. Never a real
account or card. `bun packages/shell/test/fixtures/sign-in-site/server.ts`
serves it on `http://signin.localhost:8443/` and prints the two-factor
setup key.

## Checks

- `cargo test -p dashi-secretd`: encryption at rest, a changed byte and
  another uid's vault refused, the TPM share, callers (an agent's cgroup
  refused everything, root only PAM's ops), wrong passwords slowed, logins
  listed without secrets, "Never" refused, TOTP against RFC 6238's and RFC
  4226's vectors, the gnome-keyring import, Secret Service storage, CTAPHID
  framing, CTAP2 messages (signatures verified, bound to the site, never
  without the person), approvals proven by password, payments within the
  limits.
- `dbus-run-session -- sh crates/dashi-secretd/tests/bridge-secret-tool.sh
  <empty dir> target/debug`: the bridge with libsecret's `secret-tool`
  (DH sessions), and an agent's scope refused.
- `bun test` in `packages/shell`: the sandbox's arguments, the mask
  (`agent-mask.test.ts`), consent from the person only, sign-in and codes
  (`agent-sign-in.test.ts`), sources and their order, 1Password
  (`onepassword.test.ts`), payments (`agent-pay.test.ts`), the test site
  (`sign-in-site.test.ts`, passkeys included), and the shell's vault client
  against a development dashi-secretd (`vault-client.test.ts`).

In the VM (with the `dashi-secretd` package installed, greetd's login so
PAM opens the vault, and the test site served from the checkout:
`bun packages/shell/test/fixtures/sign-in-site/server.ts` in the guest):
an agent through `vm/agent` signs in on the test site, enters a code, uses
a passkey, pays a test amount, and its recordings show blanks where the
secrets were. The steps are in the 0.4.0 handoff. Use an ordinary browser,
started without accessibility flags. `bun packages/shell/bin/dashi-a11y-probe.ts
[PID] [--wake] [--find]` (in the session) shows what the shell sees of an
app: its password fields, the focused field, the documents around it;
`bin/dashi-a11y-again.ts PID [WAIT]` asks for a password field again after
you navigate the page (what the mask does for a filled field).

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
