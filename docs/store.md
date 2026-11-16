# The Store

The Store (`packages/shell/apps/software`, id `dev.dashi.software`; called
Software until 0.9, decisions.md D324) installs apps from four kinds of source
and Dashi's own add-ons. Decisions D320 to D329.

## Sources

| Source | What | Who vouches | Turn off |
| --- | --- | --- | --- |
| Flathub | Flatpak apps, sandboxed, for the person | Flathub; "verified" per app | Yes (`flatpak remote-modify`) |
| Fedora | `fedora`, `updates`, `fedora-cisco-openh264` | Fedora's key | No |
| Dashi | COPR `pejedev/dashi` | Dashi | No |
| Terra | on by default (`dashi-release`, D329) | Terra's key | Yes (`pkcon repo-disable terra`) |
| A COPR the person enabled | `dnf copr enable owner/project` | "Community build, not reviewed by Fedora" | Yes |
| RPM Fusion and any other repository that is on | counted like a COPR | the repository's key | Yes |

The Store never searches COPR at large and never adds a source. A COPR
enabled in Terminal shows up in Sources by itself. Order when several have an
app: installed, Flathub, Fedora, Dashi, Terra, COPR (D321).

## The catalog

`shared/software/catalog.ts`: Flathub's `appstream.xml.gz` (daily, ETag),
`/usr/share/swcatalog/xml/*` (Fedora, RPM Fusion), and dnf's cache
(`dnf5 repoquery --cacheonly`; apps are packages with `application()`
provides). Search is in memory and offline. Each source answers on its own.

## Installing

Flatpaks as in 0.8 (`flatpak install --user`). Packages through PackageKit
(`pkcon install name;evr;arch;repo`, D322); polkit asks for the password for a
new package, a removal and a source change, not for updates from a source
already on. Dashi's own packages update as their own row
(`pkcon update <names>`), then "Log out to finish".

## Add-ons

One package kind, the signed `.dashi-applet` (docs/applets.md). An add-on
with `commands` is on the Launcher extensions shelf (and on Menu bar applets).
Updates that ask for nothing new install by themselves (D327). The launcher's
"Store" scope gets one without leaving (D328). The Store reads only the
existing package format: the launcher-extension runtime (`v09/launcher-ext`)
adds views behind the same `commands`; nothing here depends on its new fields.

## Agents

`search_software`, `get_software`, `list_installed_software`,
`request_software_install` reach every source; ids name the source
(`rpm:htop@fedora`, D325). An install is asked of the person on screen every
time.
