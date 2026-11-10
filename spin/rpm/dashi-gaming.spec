# dashi-gaming: Steam and what Proton games need around it. Offered by the
# Setup Assistant (dashi-extras gaming), not in the image. Built by spin/build-rpms.
Name:           dashi-gaming
Version:        44
Release:        %{dashi_snapshot}%{?dist}
Summary:        Gaming on Dashi: Steam, Proton's needs, and the tools around them
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
BuildArch:      noarch
BuildRequires:  systemd-rpm-macros

# Steam is in RPM Fusion nonfree.
Requires:       rpmfusion-nonfree-release
Requires:       steam
# The 32-bit graphics stack Steam and Proton's 32-bit games load.
Requires:       mesa-dri-drivers(x86-32)
Requires:       mesa-vulkan-drivers(x86-32)
Requires:       mesa-libGL(x86-32)
Requires:       vulkan-loader(x86-32)
# Controllers and VR headsets (udev rules).
Requires:       steam-devices
Requires:       gamemode
Requires:       gamescope
Requires:       mangohud

%description
Steam from RPM Fusion, the 32-bit Mesa and Vulkan libraries Proton needs,
udev rules for controllers, GameMode, gamescope, and MangoHud, with the
kernel settings games run better with (a larger memory map count, no
split-lock penalty).

%prep
%autosetup -n %{dashi_source}

%build

%install
cp -a spin/dashi-gaming/usr %{buildroot}/

%post
# The settings now, not only from the next boot.
%sysctl_apply 80-dashi-gaming.conf

%files
%license LICENSE
%{_prefix}/lib/sysctl.d/80-dashi-gaming.conf

%changelog
* Mon Nov 02 2026 PejeDev <hi@peje.dev> - 44-0.2.0
- Steam, the 32-bit graphics stack, GameMode, gamescope, MangoHud, and sysctl tuning.
