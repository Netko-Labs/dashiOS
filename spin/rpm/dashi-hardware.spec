# dashi-hardware: Dashi's privileged hardware helper (Rust). Built by
# spin/build-rpms, which sets dashi_snapshot and dashi_source in the SRPM's
# spec, and may define cargo_target (where Cargo builds, outside the source
# tree); elsewhere (COPR) Cargo builds in the build dir.
%global debug_package %{nil}
%{!?cargo_target:%global cargo_target %{_builddir}/cargo-target}

Name:           dashi-hardware
Version:        %{dashi_snapshot}
Release:        1%{?dist}
Summary:        Dashi's privileged hardware helper
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
ExclusiveArch:  x86_64 aarch64

BuildRequires:  cargo >= 1.88
BuildRequires:  rust >= 1.88
BuildRequires:  systemd-rpm-macros

Requires:       polkit
# tuned-ppd serves the power-profiles D-Bus API the shell's mode row talks to.
Requires:       tuned-ppd
%{?systemd_requires}

%description
dashi-hardware is Dashi's one privileged helper for what a laptop's kernel
exposes: firmware attributes, platform profiles, the charge limit, fan
curves, the keyboard light, cpufreq boost and EPP, and AMD's SMU mailbox (the
Curve Optimizer). It is a system-bus service (dev.dashi.Hardware1), D-Bus
activated, with a polkit action per kind of change. It decides no policy; the
shell does. See docs/hardware.md.

%prep
%autosetup -n %{dashi_source}

%build
# Network is needed for the crates (no vendored sources); a local rpmbuild has it.
export CARGO_TARGET_DIR=%{cargo_target}
cargo build --release --locked -p dashi-hardware

%install
export CARGO_TARGET_DIR=%{cargo_target}
install -Dm0755 %{cargo_target}/release/dashi-hardware %{buildroot}%{_libexecdir}/dashi/dashi-hardware

# The model database.
install -d %{buildroot}%{_datadir}/dashi/models
install -m0644 data/models/*.json %{buildroot}%{_datadir}/dashi/models/

# D-Bus, polkit, systemd.
install -Dm0644 spin/dashi-hardware/usr/share/dbus-1/system.d/dev.dashi.Hardware1.conf %{buildroot}%{_datadir}/dbus-1/system.d/dev.dashi.Hardware1.conf
install -Dm0644 spin/dashi-hardware/usr/share/dbus-1/system-services/dev.dashi.Hardware1.service %{buildroot}%{_datadir}/dbus-1/system-services/dev.dashi.Hardware1.service
install -Dm0644 spin/dashi-hardware/usr/share/polkit-1/actions/dev.dashi.hardware.policy %{buildroot}%{_datadir}/polkit-1/actions/dev.dashi.hardware.policy
for unit in dashi-hardware dashi-hardware-boot dashi-hardware-clean; do
  install -Dm0644 spin/dashi-hardware/usr/lib/systemd/system/$unit.service %{buildroot}%{_unitdir}/$unit.service
done

# tuned profiles (thin: Dashi's recipe owns EPP, the profile, boost and the
# power limits) and tuned-ppd's mapping to them.
for profile in dashi-powersave dashi-balanced dashi-performance; do
  install -Dm0644 spin/dashi-hardware/usr/lib/tuned/$profile/tuned.conf %{buildroot}%{_prefix}/lib/tuned/$profile/tuned.conf
done
# tuned-ppd owns /etc/tuned/ppd.conf, so Dashi's mapping is shipped beside it
# and put in place by the scriptlets below (the stock file kept as .dashi-orig).
install -Dm0644 spin/dashi-hardware/etc/tuned/ppd.conf %{buildroot}%{_datadir}/dashi/tuned/ppd.conf

install -d %{buildroot}%{_presetdir}
echo "enable dashi-hardware-boot.service" > %{buildroot}%{_presetdir}/80-dashi-hardware.preset
echo "enable dashi-hardware-clean.service" >> %{buildroot}%{_presetdir}/80-dashi-hardware.preset

# Put Dashi's tuned-ppd mapping in place, once: the stock file is kept beside
# it (as ppd.conf.dashi-orig, restored on removal). %%triggerin covers
# tuned-ppd arriving after this package in the same transaction.
%define dashi_ppd_apply \
conf=%{_sysconfdir}/tuned/ppd.conf \
if [ -f "$conf" ] && ! grep -q dashi-balanced "$conf"; then \
  cp -a "$conf" "$conf.dashi-orig" \
  cp %{_datadir}/dashi/tuned/ppd.conf "$conf" \
  systemctl try-restart tuned-ppd.service >/dev/null 2>&1 || : \
fi

%post
%systemd_post dashi-hardware-boot.service dashi-hardware-clean.service
%{dashi_ppd_apply}

%triggerin -- tuned-ppd
%{dashi_ppd_apply}

%preun
%systemd_preun dashi-hardware-boot.service dashi-hardware-clean.service

%postun
%systemd_postun dashi-hardware-boot.service dashi-hardware-clean.service
# Removed: tuned-ppd's own mapping comes back.
if [ $1 -eq 0 ] && [ -f %{_sysconfdir}/tuned/ppd.conf.dashi-orig ]; then
  mv -f %{_sysconfdir}/tuned/ppd.conf.dashi-orig %{_sysconfdir}/tuned/ppd.conf
  systemctl try-restart tuned-ppd.service >/dev/null 2>&1 || :
fi

%files
%{_libexecdir}/dashi/dashi-hardware
%dir %{_datadir}/dashi/models
%{_datadir}/dashi/models/*.json
%{_datadir}/dbus-1/system.d/dev.dashi.Hardware1.conf
%{_datadir}/dbus-1/system-services/dev.dashi.Hardware1.service
%{_datadir}/polkit-1/actions/dev.dashi.hardware.policy
%{_unitdir}/dashi-hardware.service
%{_unitdir}/dashi-hardware-boot.service
%{_unitdir}/dashi-hardware-clean.service
%dir %{_prefix}/lib/tuned/dashi-powersave
%dir %{_prefix}/lib/tuned/dashi-balanced
%dir %{_prefix}/lib/tuned/dashi-performance
%{_prefix}/lib/tuned/dashi-powersave/tuned.conf
%{_prefix}/lib/tuned/dashi-balanced/tuned.conf
%{_prefix}/lib/tuned/dashi-performance/tuned.conf
%dir %{_datadir}/dashi/tuned
%{_datadir}/dashi/tuned/ppd.conf
%{_presetdir}/80-dashi-hardware.preset

%changelog
* Thu Nov 05 2026 PejeDev <hi@peje.dev> - 0.4.0
- The hardware helper: firmware attributes, profiles, charge limit, fan
  curves, cpufreq, the SMU Curve Optimizer, the boot guard, and the model
  database. Thin tuned profiles and tuned-ppd's mapping to them.
