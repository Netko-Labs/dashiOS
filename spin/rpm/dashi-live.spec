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
Requires:       livesys-scripts
Requires:       helium-bin

%description
What Dashi's live ISO adds at boot (livesys-scripts runs livesys-dashi only
on a live boot): autologin into Dashi (greetd's initial session), a polkit
rule so the installer opens without a password, and "Install Dashi" in the
launcher. Anaconda's web UI opens in Helium (installer-browser). Installed
systems keep the files, which do nothing there.

%prep
%autosetup -n %{dashi_source}

%build

%install
cd spin/dashi-live
install -Dm0644 etc/anaconda/conf.d/90-dashi.conf %{buildroot}%{_sysconfdir}/anaconda/conf.d/90-dashi.conf
install -Dm0755 usr/libexec/dashi/installer-browser %{buildroot}%{_libexecdir}/dashi/installer-browser
install -Dm0755 usr/libexec/livesys/sessions.d/livesys-dashi %{buildroot}%{_libexecdir}/livesys/sessions.d/livesys-dashi

%files
%config(noreplace) %{_sysconfdir}/anaconda/conf.d/90-dashi.conf
%dir %{_libexecdir}/dashi
%{_libexecdir}/dashi/installer-browser
%{_libexecdir}/livesys/sessions.d/livesys-dashi

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 0.2.0
- Autologin through greetd, for Dashi's own login screen.
