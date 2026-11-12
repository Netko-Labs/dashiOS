# dashi-comp: Dashi's Wayland compositor (Rust, smithay). Built by
# spin/build-rpms, which sets dashi_snapshot and dashi_source in the SRPM's
# spec, and may define cargo_target (where Cargo builds, outside the source
# tree, so local builds reuse it); elsewhere (COPR) Cargo builds in the build dir.
%global debug_package %{nil}
%{!?cargo_target:%global cargo_target %{_builddir}/cargo-target}

Name:           dashi-comp
Version:        %{dashi_snapshot}
Release:        1%{?dist}
Summary:        Dashi's Wayland compositor
License:        Apache-2.0 AND BSD-3-Clause AND ISC AND MIT AND Unicode-3.0 AND Zlib
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
ExclusiveArch:  x86_64 aarch64

BuildRequires:  cargo >= 1.88
BuildRequires:  rust >= 1.88
BuildRequires:  pkgconfig(libinput)
BuildRequires:  pkgconfig(libseat)
BuildRequires:  pkgconfig(gbm)
BuildRequires:  pkgconfig(xkbcommon)
BuildRequires:  pkgconfig(libudev)
BuildRequires:  pkgconfig(egl)
BuildRequires:  pkgconfig(gstreamer-1.0)
BuildRequires:  pkgconfig(gstreamer-app-1.0)
BuildRequires:  pkgconfig(gstreamer-video-1.0)

Requires:       mesa-dri-drivers
Requires:       mesa-libgbm
Requires:       libEGL
Requires:       xkeyboard-config
Recommends:     xorg-x11-server-Xwayland
Recommends:     gstreamer1-plugins-base

%description
dashi-comp shows Dashi: it draws the screens (DRM/KMS), routes input
(libinput), runs X11 apps (Xwayland), and serves the Wayland protocols. Every
decision is the shell's, sent over its IPC socket.

%prep
%autosetup -n %{dashi_source}

%build
# Network is needed for the crates (no vendored sources); a local rpmbuild has it.
export CARGO_TARGET_DIR=%{cargo_target}
cargo build --release --locked -p dashi-comp

%install
install -Dm0755 %{cargo_target}/release/dashi-comp %{buildroot}%{_bindir}/dashi-comp

%check
export CARGO_TARGET_DIR=%{cargo_target}
cargo test --release --locked -p dashi-comp

%files
%license LICENSE
%license THIRD-PARTY-NOTICES.md
%license spin/dashi-comp/usr/share/licenses/dashi-comp/LICENSE.dependencies
%license spin/dashi-comp/usr/share/licenses/dashi-comp/LICENSE-smithay.txt
%{_bindir}/dashi-comp

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 0.2.0
- The compositor, rewritten: udev and nested backends, Xwayland, greeter mode,
  explicit sync, VRR, presentation time, and the modern Wayland protocols.
