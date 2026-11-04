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
Requires:       xdg-desktop-portal
Requires:       xdg-desktop-portal-gtk
Requires:       xdg-desktop-portal-wlr
Requires:       adwaita-cursor-theme
Requires:       rsms-inter-fonts
Requires:       google-noto-sans-fonts
Requires:       google-noto-sans-mono-fonts
Requires:       google-noto-sans-symbols-2-fonts
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
install -Dm0755 session/dashi-session %{buildroot}%{_bindir}/dashi-session
install -Dm0755 session/dashi-mcp %{buildroot}%{_bindir}/dashi-mcp
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
