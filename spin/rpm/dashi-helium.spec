# dashi-helium: Helium's defaults on Dashi. Built by spin/build-rpms.
Name:           dashi-helium
Version:        %{dashi_snapshot}
Release:        1%{?dist}
Summary:        Helium on Dashi: its defaults, and Dashi's extension that lets agents use websites
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
BuildArch:      noarch

Requires:       helium-bin
# The extension's native host (dashi-browser-host) and the shell it talks to.
Requires:       dashi

%description
The browser's first-run preferences on Dashi (/opt/helium/initial_preferences),
and Dashi's browser extension (docs/actions.md, "Websites"): the CRX, which a
managed policy force-installs from a local update manifest, and the manifest
of its native messaging host, which allows only that extension's id. Helium
reads Chromium's system paths (/etc/chromium), so Chromium gets them too.

The CRX is built and signed by spin/build-rpms with the extension's private
key ($DASHI_EXTENSION_KEY, by default ~/.config/dashi-build/browser-extension.pem
on the machine that builds the packages; never in the repository). Its public
half is the extension manifest's "key", which fixes the id.

%prep
%autosetup -n %{dashi_source}

%build

%install
install -Dm0644 spin/dashi-helium/opt/helium/initial_preferences %{buildroot}/opt/helium/initial_preferences
install -Dm0644 vendor/browser/dashi-browser.crx %{buildroot}%{_datadir}/dashi/browser/dashi-browser.crx
install -Dm0644 vendor/browser/updates.xml %{buildroot}%{_datadir}/dashi/browser/updates.xml
install -Dm0644 spin/dashi-helium/etc/chromium/policies/managed/dashi.json %{buildroot}%{_sysconfdir}/chromium/policies/managed/dashi.json
install -Dm0644 spin/dashi-helium/etc/chromium/native-messaging-hosts/dev.dashi.browser.json %{buildroot}%{_sysconfdir}/chromium/native-messaging-hosts/dev.dashi.browser.json

%files
%license LICENSE
/opt/helium/initial_preferences
%dir %{_datadir}/dashi/browser
%{_datadir}/dashi/browser/dashi-browser.crx
%{_datadir}/dashi/browser/updates.xml
%dir %{_sysconfdir}/chromium
%dir %{_sysconfdir}/chromium/policies
%dir %{_sysconfdir}/chromium/policies/managed
%config %{_sysconfdir}/chromium/policies/managed/dashi.json
%dir %{_sysconfdir}/chromium/native-messaging-hosts
%config %{_sysconfdir}/chromium/native-messaging-hosts/dev.dashi.browser.json

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 0.2.0
- Rebuilt for 0.2.0.
