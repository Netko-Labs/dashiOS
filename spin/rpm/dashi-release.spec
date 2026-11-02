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
package repositories.

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

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 44-0.2.0
- Dashi 0.2 beta.
