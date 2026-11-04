# libghostty-vt: Ghostty's terminal emulation core as a C library (escape
# sequence parsing, terminal state, scrollback, reflow, key encoding), which
# Dashi's Terminal (dashi-term) is built on. Built with Zig: Ghostty 1.4
# needs Zig 0.17, newer than Fedora 44's, so the official Zig release is a
# source of this package and is used only to build it. Zig fetches
# Ghostty's own dependencies while building, so the builder needs the
# network (COPR: enable-net, as for Cargo).
%global debug_package %{nil}
%global zig_version 0.17.0

Name:           libghostty-vt
Version:        1.4.0
Release:        1%{?dist}
Summary:        Ghostty's terminal emulator core, as a C library
License:        MIT
URL:            https://ghostty.org
Source0:        https://github.com/ghostty-org/ghostty/archive/refs/tags/v%{version}.tar.gz#/ghostty-%{version}.tar.gz
Source1:        https://ziglang.org/download/%{zig_version}/zig-x86_64-linux-%{zig_version}.tar.xz
ExclusiveArch:  x86_64

%description
libghostty-vt implements the core of a modern terminal emulator, extracted
from Ghostty: parsing terminal escape sequences, maintaining terminal state
(styles, cursor, screen, scrollback, line wrapping, reflow on resize), and
encoding keyboard, mouse, focus, and paste input.

%package devel
Summary:        Headers and pkg-config file for libghostty-vt
Requires:       %{name}%{?_isa} = %{version}-%{release}

%description devel
The C headers (ghostty/vt.h) and pkg-config file for building against
libghostty-vt.

%prep
%setup -q -n ghostty-%{version}
%setup -q -T -D -a 1 -n ghostty-%{version}

%build
export ZIG_GLOBAL_CACHE_DIR=%{_builddir}/zig-cache
# The x86-64 baseline, not the builder's CPU.
zig-x86_64-linux-%{zig_version}/zig build \
  -Demit-lib-vt=true \
  -Doptimize=ReleaseFast \
  -Dtarget=x86_64-linux-gnu \
  -Dcpu=baseline \
  --prefix %{_builddir}/ghostty-vt-install

%install
root=%{_builddir}/ghostty-vt-install
install -d %{buildroot}%{_libdir} %{buildroot}%{_libdir}/pkgconfig %{buildroot}%{_includedir}
cp -a $root/lib/libghostty-vt.so* %{buildroot}%{_libdir}/
cp -a $root/include/ghostty %{buildroot}%{_includedir}/
sed -e 's|^prefix=.*|prefix=%{_prefix}|' \
    -e 's|^libdir=.*|libdir=%{_libdir}|' \
    -e 's|${prefix}/lib\b|%{_libdir}|g' \
    -e '/^Requires.private:/d' \
    $root/share/pkgconfig/libghostty-vt.pc > %{buildroot}%{_libdir}/pkgconfig/libghostty-vt.pc

%files
%license LICENSE
%{_libdir}/libghostty-vt.so.0*

%files devel
%{_libdir}/libghostty-vt.so
%{_libdir}/pkgconfig/libghostty-vt.pc
%{_includedir}/ghostty/

%changelog
* Mon Nov 02 2026 PejeDev <hi@peje.dev> - 1.4.0-1
- libghostty-vt from Ghostty 1.4.0, for Dashi's Terminal
