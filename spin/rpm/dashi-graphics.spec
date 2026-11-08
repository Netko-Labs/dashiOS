# dashi-graphics: graphics switching on two-GPU laptops, which is cardwire
# (Open Gaming Collective, https://github.com/OpenGamingCollective/cardwire).
# cardwire itself is packaged by Terra (enabled by dashi-release) as the
# `cardwire` package; this is Dashi's thin wrapper that pulls it in, keeps the
# older switchers off the bus, and is what finish-install installs on a
# machine with two GPUs. The shell (packages/shell/src/graphics/) talks to
# cardwired over D-Bus; see docs/hardware.md, "cardwire".
#
# cardwire blocks a GPU with an eBPF LSM hook, so the kernel's lsm= list needs
# `bpf`; finish-install adds it (and CachyOS's kernel carries CONFIG_BPF_LSM).
Name:           dashi-graphics
Version:        %{dashi_snapshot}
Release:        1%{?dist}
Summary:        Graphics switching for Dashi (cardwire)
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
BuildArch:      noarch
BuildRequires:  systemd-rpm-macros

Requires:       cardwire
# Exactly one GPU switcher owns the policy and the bus. cardwire supersedes
# supergfxctl and stands in for switcheroo-control: Terra's cardwire
# (0.12.3-3) Provides switcheroo-control, so a Conflicts on that name would
# conflict with cardwire itself and nothing could install.
Conflicts:      supergfxctl

%description
dashi-graphics is the graphics-switching piece of Dashi on two-GPU laptops:
it installs cardwire and keeps supergfxctl and switcheroo-control off the
machine so there is one owner of the card's state. On battery the discrete
card is blocked (it reaches D3cold); plugged in, or with a screen on its
ports, it wakes. Dashi's shell decides when, over cardwired's D-Bus API, and
turns cardwire's own battery and external-display auto-switching off so there
is one decider. The kernel command line needs `bpf` in lsm=; finish-install
adds it.

%prep
%autosetup -n %{dashi_source}

%build

%install
# Start cardwired where this package is installed.
install -d %{buildroot}%{_presetdir}
echo "enable cardwired.service" > %{buildroot}%{_presetdir}/80-dashi-graphics.preset

%post
%systemd_post cardwired.service

%preun
%systemd_preun cardwired.service

%postun
%systemd_postun cardwired.service

%files
%{_presetdir}/80-dashi-graphics.preset

%changelog
* Thu Nov 05 2026 PejeDev <hi@peje.dev> - 0.4.0
- Package cardwire as dashi-graphics; conflict with supergfxctl and
  switcheroo-control; installed by finish-install on two-GPU machines.
