# dashi-helium: Helium's defaults on Dashi. Built by spin/build-rpms.
Name:           dashi-helium
Version:        %{dashi_snapshot}
Release:        1%{?dist}
Summary:        Helium's defaults on Dashi: its GTK title bar and one-row layout
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
BuildArch:      noarch

Requires:       helium-bin

%description
The browser's first-run preferences on Dashi (/opt/helium/initial_preferences).

%prep
%autosetup -n %{dashi_source}

%build

%install
install -Dm0644 spin/dashi-helium/opt/helium/initial_preferences %{buildroot}/opt/helium/initial_preferences

%files
/opt/helium/initial_preferences

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 0.2.0
- Rebuilt for 0.2.0.
