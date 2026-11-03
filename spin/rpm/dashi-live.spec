# dashi-live: what Dashi's live ISO adds at boot. Built by spin/build-rpms.
Name:           dashi-live
Version:        %{dashi_snapshot}
Release:        1%{?dist}
Summary:        Dashi's live image: autologin, the installer entry, the installer's browser
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
BuildArch:      noarch

Requires:       dashi = %{version}-%{release}
Requires:       dashi-greeter = %{version}-%{release}
Requires:       anaconda-live
# Installing a live image copies the running system with rsync.
Requires:       rsync
Requires:       livesys-scripts
Requires:       helium-bin
# finish-install.
Requires:       dashi-kernel
Requires:       diffutils
Requires:       util-linux

%description
What Dashi's live ISO adds at boot (livesys-scripts runs livesys-dashi only
on a live boot): autologin into Dashi (greetd's initial session), a polkit
rule so the installer opens without a password, and "Install Dashi" in the
launcher. Anaconda's web UI opens in Helium (installer-browser), and once it
has installed the system, finish-install builds NVIDIA's driver for a
machine with an NVIDIA GPU (removes it otherwise) and leaves CachyOS's
kernel the only one where it boots. Installed systems keep the files, which
do nothing there.

%prep
%autosetup -n %{dashi_source}

%build

%install
cd spin/dashi-live
install -Dm0644 etc/anaconda/conf.d/90-dashi.conf %{buildroot}%{_sysconfdir}/anaconda/conf.d/90-dashi.conf
install -Dm0755 usr/libexec/dashi/installer-browser %{buildroot}%{_libexecdir}/dashi/installer-browser
install -Dm0755 usr/libexec/dashi/finish-install %{buildroot}%{_libexecdir}/dashi/finish-install
install -Dm0644 usr/share/dashi/finish-install.ks %{buildroot}%{_datadir}/dashi/finish-install.ks
install -Dm0755 usr/libexec/livesys/sessions.d/livesys-dashi %{buildroot}%{_libexecdir}/livesys/sessions.d/livesys-dashi

%files
%config(noreplace) %{_sysconfdir}/anaconda/conf.d/90-dashi.conf
%dir %{_libexecdir}/dashi
%{_libexecdir}/dashi/installer-browser
%{_libexecdir}/dashi/finish-install
%dir %{_datadir}/dashi
%{_datadir}/dashi/finish-install.ks
%{_libexecdir}/livesys/sessions.d/livesys-dashi

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 0.2.0
- Autologin through greetd, for Dashi's own login screen.
