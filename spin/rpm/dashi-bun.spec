# dashi-bun: Bun, as Dashi's session runs it (not packaged by Fedora): the
# release binary, at the version Dashi is tested with.
%global debug_package %{nil}
%global __strip /bin/true

Name:           dashi-bun
Version:        1.4.4
Release:        1%{?dist}
Summary:        The Bun JavaScript runtime, as Dashi's session uses it
License:        MIT AND LGPL-2.0-or-later AND LGPL-2.1-or-later AND BSD-2-Clause AND BSD-3-Clause AND Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND Zlib AND Unicode-3.0 AND ISC AND OpenSSL
URL:            https://bun.sh
Source0:        https://github.com/oven-sh/bun/releases/download/bun-v%{version}/bun-linux-x64.zip
Source1:        https://github.com/oven-sh/bun/releases/download/bun-v%{version}/bun-linux-aarch64.zip
Source2:        https://raw.githubusercontent.com/oven-sh/bun/bun-v%{version}/LICENSE.md
ExclusiveArch:  x86_64 aarch64
BuildRequires:  unzip

%description
Bun runs Dashi's shell, apps, and login screen. Dashi ships the version it is
tested with, in its own directory (/usr/libexec/dashi/bin), so a person's own
Bun is never touched.

%prep
%setup -q -c -T
%ifarch x86_64
unzip -q %{SOURCE0}
mv bun-linux-x64 bun
%else
unzip -q %{SOURCE1}
mv bun-linux-aarch64 bun
%endif

%build

%install
install -Dm0755 bun/bun %{buildroot}%{_libexecdir}/dashi/bin/bun
ln -s bun %{buildroot}%{_libexecdir}/dashi/bin/bunx
install -Dm0644 %{SOURCE2} %{buildroot}%{_datadir}/licenses/%{name}/LICENSE.md

%files
%dir %{_libexecdir}/dashi
%dir %{_libexecdir}/dashi/bin
%{_libexecdir}/dashi/bin/bun
%{_libexecdir}/dashi/bin/bunx
%license %{_datadir}/licenses/%{name}/LICENSE.md

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 1.4.4-1
- Bun 1.4.4.
