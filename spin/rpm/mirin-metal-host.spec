# mirin-metal-host: mirin's native host that draws a React tree with GPUI,
# built from the sibling mirin checkout (spin/build-rpms makes the tarball
# and sets mirin_snapshot and mirin_source in the SRPM's spec).
%global debug_package %{nil}
%{!?cargo_target:%global cargo_target %{_builddir}/cargo-target}

Name:           mirin-metal-host
Version:        %{mirin_snapshot}
Release:        1%{?dist}
Summary:        mirin's Metal host: React UI drawn natively with GPUI
License:        Apache-2.0 AND BSD-2-Clause AND BSD-3-Clause AND CC0-1.0 AND ISC AND MIT AND MPL-2.0 AND NCSA AND Unicode-3.0 AND Zlib
URL:            https://github.com/Netko-Labs/mirin
Source0:        %{mirin_source}.tar.gz
Source1:        %{dashi_source}.tar.gz
ExclusiveArch:  x86_64 aarch64

BuildRequires:  cargo
BuildRequires:  rust
BuildRequires:  clang
BuildRequires:  cmake
BuildRequires:  pkgconfig(wayland-client)
BuildRequires:  pkgconfig(xkbcommon)
BuildRequires:  pkgconfig(xkbcommon-x11)
BuildRequires:  pkgconfig(xcb)
BuildRequires:  pkgconfig(freetype2)
BuildRequires:  pkgconfig(fontconfig)
BuildRequires:  pkgconfig(vulkan)
BuildRequires:  pkgconfig(openssl)

Requires:       vulkan-loader
Requires:       mesa-vulkan-drivers
Requires:       libwayland-client

%description
The process that draws mirin Metal apps: it takes a React tree from Bun and
draws it with GPUI on Vulkan, on Wayland (windows and layer-shell surfaces).
Dashi's shell, apps, and login screen run on it.

%prep
%setup -q -n %{mirin_source}
%setup -q -T -D -a 1 -n %{mirin_source}

%build
cd crates/mirin-metal
export CARGO_TARGET_DIR=%{cargo_target}-mirin
cargo build --release --locked --bin mirin-metal-host

%install
install -Dm0755 %{cargo_target}-mirin/release/mirin-metal-host %{buildroot}%{_libexecdir}/dashi/mirin-metal-host

%files
%license %{dashi_source}/spin/mirin-metal-host/usr/share/licenses/mirin-metal-host/LICENSE
%license %{dashi_source}/spin/mirin-metal-host/usr/share/licenses/mirin-metal-host/LICENSE.dependencies
%dir %{_libexecdir}/dashi
%{_libexecdir}/dashi/mirin-metal-host

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 0.1.0
- Built from the mirin checkout.
