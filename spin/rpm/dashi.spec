# Dashi: the session (dashi-session), the TypeScript shell and its first-party
# apps on Bun, drawn by mirin Metal. Built by spin/build-rpms, which defines
# dashi_snapshot and dashi_source.
Name:           dashi
Version:        %{dashi_snapshot}
Release:        1%{?dist}
Summary:        The Dashi desktop: session, shell, and apps
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
BuildArch:      noarch
BuildRequires:  systemd-rpm-macros

Requires:       dashi-comp = %{version}-%{release}
# The vault apps and agents use (the Secret Service; sign-in for agents).
Requires:       dashi-secretd = %{version}-%{release}
# Power modes, the charge limit, the laptop's keys and lights (docs/hardware.md);
# D-Bus activated, so it costs nothing on a machine that never asks.
Requires:       dashi-hardware = %{version}-%{release}
Requires:       dashi-bun
Requires:       mirin-metal-host
# The Terminal's engine (apps/terminal runs it).
Requires:       dashi-term = %{version}-%{release}
Requires:       systemd
Requires:       polkit
# dashi-extras checks the network with it.
Requires:       curl
Requires:       glib2
Requires:       gsettings-desktop-schemas
Requires:       wl-clipboard
# Dashi's own portal backend (dashi-portal, apps/portal) draws every dialog;
# the wlroots one shares the screen. GTK's is not needed.
Requires:       xdg-desktop-portal
Requires:       xdg-desktop-portal-wlr
# The print sheet sends jobs to CUPS (apps/portal/print/).
Recommends:     cups
# Preview: PDFs' pages, thumbnails and words (poppler), pictures Metal can't
# draw as they are, rotation, export and print (ImageMagick); HEIC and AVIF
# pictures; a rotated PDF exported or printed whole (qpdf).
Requires:       poppler-utils
Requires:       ImageMagick
Recommends:     ImageMagick-heic
Recommends:     qpdf
Requires:       adwaita-cursor-theme
Requires:       rsms-inter-fonts
Requires:       google-noto-sans-fonts
Requires:       google-noto-sans-mono-fonts
Requires:       google-noto-sans-symbols-2-fonts
# Emoji the Metal host can draw: Twemoji is a bitmap font (CBDT); Noto Color
# Emoji, Fedora's default, is COLRv1, which the host doesn't draw yet. The
# host picks it once mirin names it in its fallbacks (tasks/todo.md, "Emoji in Metal").
Recommends:     twitter-twemoji-fonts
# X11 apps (dashi-comp starts Xwayland) and video wallpapers (GStreamer).
Requires:       xorg-x11-server-Xwayland
# X11 apps' dpi and cursor size (X resources), set when Xwayland draws at the screens' scale.
Requires:       xrdb
Requires:       gstreamer1-plugins-base
Recommends:     gstreamer1-plugins-good
Recommends:     gstreamer1-plugin-libav
Recommends:     dashi-greeter = %{version}-%{release}
# Files, Dashi's file manager (it replaces Nautilus, which brought these):
# GVfs for the Trash across disks, phones, cameras, and network shares;
# bubblewrap to sandbox the thumbnailers, which make pictures of pictures,
# videos, and songs.
Requires:       gvfs
Requires:       bubblewrap
# Applets from the Applet Store run in bubblewrap too; their D-Bus permissions go through the proxy (docs/applets.md).
Requires:       xdg-dbus-proxy
# The screen recorder (⇧❖5, src/recorder/): wf-recorder over dashi-comp's screencopy.
Requires:       wf-recorder
Recommends:     gvfs-fuse
Recommends:     gvfs-mtp
Recommends:     gvfs-smb
Recommends:     glycin-thumbnailer
Recommends:     gst-thumbnailers

%description
Dashi is a desktop on Fedora. The compositor (dashi-comp) puts pixels on the
screen; this package is everything that decides: the session supervisor, the
menu bar, the Dock, System Settings, the system services, and the first-party
apps, written in TypeScript on Bun and drawn natively by mirin Metal.

%prep
%autosetup -n %{dashi_source}

%build
# Nothing to build: Bun runs the TypeScript as it is.

%install
install -d %{buildroot}%{_datadir}/dashi
cp -a packages/shell %{buildroot}%{_datadir}/dashi/shell
rm -rf %{buildroot}%{_datadir}/dashi/shell/node_modules %{buildroot}%{_datadir}/dashi/shell/test
# Shared with the greeter: Bun finds them walking up from either.
cp -a vendor/node_modules %{buildroot}%{_datadir}/dashi/node_modules
# The Anthropic SDK ships a Node migration CLI Dashi never runs; its shebang
# would make rpm require /usr/bin/node. Dashi runs on Bun: no file here may
# want Node, or the package would pull it in.
rm -rf %{buildroot}%{_datadir}/dashi/node_modules/@anthropic-ai/sdk/bin
if grep -rlE '^#!.*\bnode\b' %{buildroot}%{_datadir}/dashi/node_modules; then
  echo "dashi.spec: files above have a Node shebang; drop them (Dashi runs on Bun)" >&2
  exit 1
fi
install -Dm0755 session/dashi-session %{buildroot}%{_bindir}/dashi-session
install -Dm0755 session/dashi-mcp %{buildroot}%{_bindir}/dashi-mcp
# Agents in a sandbox that can use secrets through Dashi but never read them.
install -Dm0755 session/dashi-agent %{buildroot}%{_bindir}/dashi-agent
# The applet SDK's CLI (@dashi/applet, in node_modules): new, dev, pack, publish.
install -Dm0755 session/dashi-applet %{buildroot}%{_bindir}/dashi-applet
# Dialogs for shell scripts, on Zenity's command line (apps/dialog).
install -Dm0755 session/dashi-dialog %{buildroot}%{_bindir}/dashi-dialog
# dashi:// links into the session (src/actions/links.ts); the shell writes the x-scheme-handler/dashi entry.
install -Dm0755 session/dashi-open %{buildroot}%{_bindir}/dashi-open
# The screen-share picker, xdg-desktop-portal-wlr's chooser in a Dashi session (src/share-picker/).
install -Dm0755 session/dashi-share-picker %{buildroot}%{_bindir}/dashi-share-picker
install -Dm0644 session/xdg-desktop-portal-wlr.conf %{buildroot}%{_sysconfdir}/xdg/xdg-desktop-portal-wlr/Dashi
# Dashi's xdg-desktop-portal backend (apps/portal), D-Bus activated through its user unit.
install -Dm0755 session/dashi-portal %{buildroot}%{_bindir}/dashi-portal
install -Dm0644 session/dashi.portal %{buildroot}%{_datadir}/xdg-desktop-portal/portals/dashi.portal
install -Dm0644 session/org.freedesktop.impl.portal.desktop.dashi.service %{buildroot}%{_datadir}/dbus-1/services/org.freedesktop.impl.portal.desktop.dashi.service
install -Dm0644 session/dashi-portal.service %{buildroot}%{_userunitdir}/dashi-portal.service
# The Setup Assistant's optional software, run as root through pkexec.
install -Dm0755 session/dashi-extras %{buildroot}%{_libexecdir}/dashi/dashi-extras
install -Dm0644 session/dev.dashi.extras.policy %{buildroot}%{_datadir}/polkit-1/actions/dev.dashi.extras.policy
install -Dm0644 session/dashi-session.target %{buildroot}%{_userunitdir}/dashi-session.target
install -Dm0644 session/dashi.desktop %{buildroot}%{_datadir}/wayland-sessions/dashi.desktop
install -Dm0644 session/dashi-portals.conf %{buildroot}%{_datadir}/xdg-desktop-portal/dashi-portals.conf
install -Dm0644 session/dashi-mimeapps.list %{buildroot}%{_datadir}/applications/dashi-mimeapps.list
install -Dm0644 vendor/MIRIN_COMMIT %{buildroot}%{_datadir}/dashi/MIRIN_COMMIT

%files
%doc README.md
%{_bindir}/dashi-session
%{_bindir}/dashi-mcp
%{_bindir}/dashi-agent
%{_bindir}/dashi-applet
%{_bindir}/dashi-dialog
%{_bindir}/dashi-open
%{_bindir}/dashi-share-picker
%dir %{_sysconfdir}/xdg/xdg-desktop-portal-wlr
%config(noreplace) %{_sysconfdir}/xdg/xdg-desktop-portal-wlr/Dashi
%{_bindir}/dashi-portal
%{_datadir}/xdg-desktop-portal/portals/dashi.portal
%{_datadir}/dbus-1/services/org.freedesktop.impl.portal.desktop.dashi.service
%{_userunitdir}/dashi-portal.service
%dir %{_libexecdir}/dashi
%{_libexecdir}/dashi/dashi-extras
%{_datadir}/polkit-1/actions/dev.dashi.extras.policy
%{_userunitdir}/dashi-session.target
%{_datadir}/wayland-sessions/dashi.desktop
%{_datadir}/xdg-desktop-portal/dashi-portals.conf
%{_datadir}/applications/dashi-mimeapps.list
%dir %{_datadir}/dashi
%{_datadir}/dashi/shell
%{_datadir}/dashi/node_modules
%{_datadir}/dashi/MIRIN_COMMIT

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 0.2.0
- 0.2.0: the rewritten compositor, Dashi's own login screen, native video
  wallpapers, @dashi/ui.
