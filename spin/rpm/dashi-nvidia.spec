# dashi-nvidia: NVIDIA's driver, built for every installed kernel. Built by spin/build-rpms.
Name:           dashi-nvidia
Version:        44
Release:        %{dashi_snapshot}%{?dist}
Summary:        NVIDIA's driver for Dashi, built for every installed kernel
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
BuildArch:      noarch

Requires:       rpmfusion-nonfree-release
Requires:       akmod-nvidia
Requires:       xorg-x11-drv-nvidia
Requires:       xorg-x11-drv-nvidia-power
Requires:       kernel-devel-matched
Requires:       (kernel-cachyos-devel-matched if kernel-cachyos-core)

%description
RPM Fusion's NVIDIA driver (akmod), with the headers for every installed
kernel so it is built for each, DRM modesetting on (Wayland needs it), and
the modules in the initramfs.

%prep
%autosetup -n %{dashi_source}

%build

%install
cp -a spin/dashi-nvidia/usr %{buildroot}/

%files
%{_prefix}/lib/dracut/dracut.conf.d/90-dashi-nvidia.conf
%{_prefix}/lib/modprobe.d/dashi-nvidia.conf

%changelog
* Sun Nov 01 2026 PejeDev <hi@peje.dev> - 44-0.2.0
- Rebuilt for 0.2.0.
