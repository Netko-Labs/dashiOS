# dashi-kernel: CachyOS's kernel as Dashi's default wherever it boots. Built by spin/build-rpms.
Name:           dashi-kernel
Version:        44
Release:        %{dashi_snapshot}%{?dist}
Summary:        CachyOS's kernel for Dashi, the default wherever it boots
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
BuildArch:      noarch
BuildRequires:  systemd-rpm-macros

Requires:       kernel-cachyos
Requires:       grubby
Requires:       coreutils
Requires:       findutils
Requires:       grep
Requires:       sed

%description
The CachyOS kernel repository and the default-kernel logic: whichever kernel
/etc/dashi/kernel.conf prefers boots by default, re-picked whenever a kernel
is installed (kernel-install) and at boot (dashi-default-kernel.service).
ntsync is loaded for Wine and Proton.

%prep
%autosetup -n %{dashi_source}

%build

%install
cp -a spin/dashi-kernel/etc spin/dashi-kernel/usr %{buildroot}/

%post
%systemd_post dashi-default-kernel.service
# Installed on a running system: pick the default now (the kernels came first).
%{_libexecdir}/dashi/default-kernel || :

%preun
%systemd_preun dashi-default-kernel.service

%files
%license LICENSE
%dir %{_sysconfdir}/dashi
%config(noreplace) %{_sysconfdir}/dashi/kernel.conf
%config(noreplace) %{_sysconfdir}/yum.repos.d/_copr:copr.fedorainfracloud.org:bieszczaders:kernel-cachyos.repo
%{_prefix}/lib/kernel/install.d/99-dashi-default-kernel.install
%{_prefix}/lib/modules-load.d/dashi-ntsync.conf
%{_presetdir}/80-dashi-kernel.preset
%{_unitdir}/dashi-default-kernel.service
%dir %{_libexecdir}/dashi
%{_libexecdir}/dashi/default-kernel

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 44-0.2.0
- Rebuilt for 0.2.0.
