# dashi-release: Dashi's identity on Fedora 44 (os-release, the dist macros,
# presets, repos), in place of fedora-release. Built by spin/build-rpms; its
# version is Fedora's, its release Dashi's build.
Name:           dashi-release
Version:        44
Release:        %{dashi_snapshot}%{?dist}
Summary:        Dashi release files
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
BuildArch:      noarch

Requires:       fedora-repos(44)
# zsh is Dashi's shell: new accounts get it (%posttrans). A plain Requires,
# not Requires(post): setup requires system-release (this package), so a
# scriptlet dependency on zsh or shadow-utils (which need filesystem, which
# needs setup) made a loop rpm could only break by installing filesystem
# late, and a fresh install root then had no /bin/sh for the first %pre.
Requires:       zsh
# Terra (Fyra Labs) is on by default: terra-release owns its repo file and
# key. Recommends, not Requires: a system without Terra configured can still
# update this package, and someone who removes Terra keeps Dashi.
Recommends:     terra-release
# HEIC decodes through Fedora's FFmpeg plugin (H.265 from the FFmpeg the codecs
# step installs); RPM Fusion's libheif-freeworld pins the exact libheif it was
# built against and held back Fedora's libheif updates, security fixes too.
# Obsoletes takes it off 0.2.0 installs on update.
Obsoletes:      libheif-freeworld
Recommends:     libheif-ffmpeg
Provides:       system-release
Provides:       system-release(44)
Provides:       system-release(releasever) = 44
Provides:       base-module(platform:f44)
Provides:       fedora-release = %{version}-%{release}
Provides:       fedora-release-common = %{version}-%{release}
Provides:       fedora-release-identity = %{version}-%{release}
Provides:       fedora-release-variant = %{version}-%{release}
Conflicts:      fedora-release
Conflicts:      fedora-release-common
Conflicts:      fedora-release-identity
Conflicts:      generic-release
Conflicts:      generic-release-common

%description
Dashi's os-release, release files, RPM dist macros, systemd presets, and
package repositories; and zsh as the shell new accounts get, with Dashi's defaults for it
(history, completion, a prompt, aliases).

%prep
%autosetup -n %{dashi_source}

%build

%install
cd spin/dashi-release
cp -a usr etc %{buildroot}/
sed -i 's/@DASHI_BUILD@/%{dashi_snapshot}/' %{buildroot}%{_prefix}/lib/os-release
ln -s ../usr/lib/os-release %{buildroot}%{_sysconfdir}/os-release
ln -s ../usr/lib/dashi-release %{buildroot}%{_sysconfdir}/dashi-release
ln -s ../usr/lib/fedora-release %{buildroot}%{_sysconfdir}/fedora-release
ln -s dashi-release %{buildroot}%{_sysconfdir}/redhat-release
ln -s dashi-release %{buildroot}%{_sysconfdir}/system-release
ln -s ../usr/lib/system-release-cpe %{buildroot}%{_sysconfdir}/system-release-cpe
ln -s ../usr/lib/issue %{buildroot}%{_sysconfdir}/issue
ln -s ../usr/lib/issue.net %{buildroot}%{_sysconfdir}/issue.net
install -d %{buildroot}%{_sysconfdir}/issue.d

%posttrans
# At the end of the transaction, when zsh, shadow-utils, and the tools here
# are installed. New accounts (the installer's, the live user, Users &
# Accounts) get zsh: useradd's default, while it is still the stock bash.
if [ -f %{_sysconfdir}/default/useradd ] && grep -q '^SHELL=/bin/bash$' %{_sysconfdir}/default/useradd; then
  sed -i 's|^SHELL=/bin/bash$|SHELL=/bin/zsh|' %{_sysconfdir}/default/useradd
fi

# Every interactive zsh starts from Dashi's defaults: one marked line in
# /etc/zshrc (zsh's own config file) sources them.
if [ -f %{_sysconfdir}/zshrc ] && ! grep -q 'dashi.zshrc' %{_sysconfdir}/zshrc; then
  printf '\n# Dashi defaults (dashi-release)\n[ -r %{_datadir}/dashi/zsh/dashi.zshrc ] && . %{_datadir}/dashi/zsh/dashi.zshrc\n' >> %{_sysconfdir}/zshrc
fi

%postun
if [ $1 -eq 0 ] && [ -f %{_sysconfdir}/zshrc ]; then
  sed -i '/# Dashi defaults (dashi-release)/d; /dashi\/zsh\/dashi.zshrc/d' %{_sysconfdir}/zshrc
fi

%files
%{_datadir}/licenses/dashi-release
%{_prefix}/lib/os-release
%{_prefix}/lib/dashi-release
%{_prefix}/lib/fedora-release
%{_prefix}/lib/issue
%{_prefix}/lib/issue.net
%{_prefix}/lib/system-release-cpe
%{_prefix}/lib/rpm/macros.d/macros.dist
%{_prefix}/lib/systemd/system-preset/*.preset
%{_prefix}/lib/systemd/user-preset/*.preset
%{_datadir}/dnf5/libdnf.conf.d/20-fedora-defaults.conf
%{_sysconfdir}/os-release
%{_sysconfdir}/dashi-release
%{_sysconfdir}/fedora-release
%{_sysconfdir}/redhat-release
%{_sysconfdir}/system-release
%{_sysconfdir}/system-release-cpe
%config(noreplace) %{_sysconfdir}/issue
%config(noreplace) %{_sysconfdir}/issue.net
%dir %{_sysconfdir}/issue.d
%dir %{_sysconfdir}/anaconda
%dir %{_sysconfdir}/anaconda/profile.d
%{_sysconfdir}/anaconda/profile.d/dashi.conf
%config(noreplace) %{_sysconfdir}/yum.repos.d/*.repo
%dir %{_datadir}/dashi
%dir %{_datadir}/dashi/zsh
%{_datadir}/dashi/zsh/dashi.zshrc

%changelog
* Mon Nov 02 2026 PejeDev <hi@peje.dev> - 44-0.3.0
- Dashi 0.3 beta.
- libheif-ffmpeg in place of libheif-freeworld, which held libheif's updates back.

* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 44-0.2.0
- Dashi 0.2 beta.
