# dashi-greeter: Dashi's own login screen, greetd's greeter, in place of
# 0.1.0's borrowed SDDM (dashi-sddm). Built by spin/build-rpms.
Name:           dashi-greeter
Version:        %{dashi_snapshot}
Release:        1%{?dist}
Summary:        Dashi's login screen
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
BuildArch:      noarch
BuildRequires:  systemd-rpm-macros

Requires:       dashi = %{version}-%{release}
Requires:       greetd
Obsoletes:      dashi-sddm < 0.2.0
Provides:       dashi-sddm = %{version}-%{release}

%description
The login screen: TypeScript drawn by mirin Metal (@dashi/ui's LoginScreen,
the same as the lock screen), run by greetd on dashi-comp in greeter mode.
PAM and sessions are greetd's.

%prep
%autosetup -n %{dashi_source}

%build

%install
install -d %{buildroot}%{_datadir}/dashi
cp -a packages/greeter %{buildroot}%{_datadir}/dashi/greeter
rm -rf %{buildroot}%{_datadir}/dashi/greeter/node_modules %{buildroot}%{_datadir}/dashi/greeter/test
install -Dm0755 session/dashi-greeter %{buildroot}%{_bindir}/dashi-greeter
# greetd's own config stays greetd's: the service is pointed at Dashi's.
install -Dm0644 spin/dashi-greeter/etc/greetd/config.toml %{buildroot}%{_datadir}/dashi/greetd/config.toml
install -d %{buildroot}%{_unitdir}/greetd.service.d
cat > %{buildroot}%{_unitdir}/greetd.service.d/dashi.conf <<'CONF'
# Dashi's login screen (dashi-greeter).
[Service]
ExecStart=
ExecStart=/usr/bin/greetd --config /usr/share/dashi/greetd/config.toml
CONF
install -d %{buildroot}%{_presetdir}
echo "enable greetd.service" > %{buildroot}%{_presetdir}/80-dashi-greeter.preset

%post
%systemd_post greetd.service
# Installed over 0.1.0 (SDDM was the display manager): the login screen is Dashi's now.
if [ $1 -eq 1 ] && [ "$(readlink /etc/systemd/system/display-manager.service 2>/dev/null)" != "%{_unitdir}/greetd.service" ]; then
  systemctl enable --force greetd.service >/dev/null 2>&1 || :
fi

%preun
%systemd_preun greetd.service

%files
%{_bindir}/dashi-greeter
%{_datadir}/dashi/greeter
%dir %{_datadir}/dashi/greetd
%{_datadir}/dashi/greetd/config.toml
%{_unitdir}/greetd.service.d/dashi.conf
%{_presetdir}/80-dashi-greeter.preset

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 0.2.0
- Dashi's own login screen on greetd, replacing dashi-sddm.
