# dashi-logos: Dashi's logo, icon, and Plymouth boot splash. Built by spin/build-rpms.
Name:           dashi-logos
Version:        44
Release:        %{dashi_snapshot}%{?dist}
Summary:        Dashi's logo, its icon, and its boot splash
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
BuildArch:      noarch

Requires:       generic-logos
Requires:       plymouth-plugin-two-step
Requires:       plymouth-theme-spinner

%description
Dashi's logo (os-release LOGO=dashi-logo-icon), its icon at every size, and
the "dashi" Plymouth theme shown while the system boots.

%prep
%autosetup -n %{dashi_source}

%build

%install
cp -a spin/dashi-logos/usr %{buildroot}/

%files
%{_datadir}/icons/hicolor/*/apps/dashi-logo-icon.*
%{_datadir}/pixmaps/dashi-logo.png
%{_datadir}/plymouth/themes/dashi

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 44-0.2.0
- Rebuilt for 0.2.0.
