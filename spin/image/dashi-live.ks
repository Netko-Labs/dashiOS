# Dashi's live image (and installer): Fedora 44 with Dashi's packages, built
# by spin/build-image with livemedia-creator. @DASHI_REPO@ is replaced by the
# local repository of the packages spin/build-rpms made.

lang en_US.UTF-8
keyboard us
timezone UTC
selinux --enforcing
firewall --enabled --service=mdns
network --bootproto=dhcp --device=link --activate
rootpw --lock
services --enabled=NetworkManager,ModemManager,greetd --disabled=sshd
bootloader --location=none
zerombr
clearpart --all
part / --size 16384 --fstype ext4
shutdown

url --mirrorlist=https://mirrors.fedoraproject.org/mirrorlist?repo=fedora-$releasever&arch=$basearch
repo --name=dashi-image-updates --mirrorlist=https://mirrors.fedoraproject.org/mirrorlist?repo=updates-released-f$releasever&arch=$basearch
repo --name=dashi-image-rpmfusion-free --mirrorlist=https://mirrors.rpmfusion.org/mirrorlist?repo=free-fedora-$releasever&arch=$basearch
repo --name=dashi-image-rpmfusion-free-updates --mirrorlist=https://mirrors.rpmfusion.org/mirrorlist?repo=free-fedora-updates-released-$releasever&arch=$basearch
repo --name=dashi-image-rpmfusion-nonfree --mirrorlist=https://mirrors.rpmfusion.org/mirrorlist?repo=nonfree-fedora-$releasever&arch=$basearch
repo --name=dashi-image-rpmfusion-nonfree-updates --mirrorlist=https://mirrors.rpmfusion.org/mirrorlist?repo=nonfree-fedora-updates-released-$releasever&arch=$basearch
repo --name=dashi-image-cachyos --baseurl=https://download.copr.fedorainfracloud.org/results/bieszczaders/kernel-cachyos/fedora-$releasever-$basearch/
repo --name=dashi-image-helium --baseurl=https://download.copr.fedorainfracloud.org/results/imput/helium/fedora-$releasever-$basearch/
repo --name=dashi-image-local --baseurl=@DASHI_REPO@ --cost=10

%packages
@core
@hardware-support
@fonts
@multimedia
@networkmanager-submodules
@printing
kernel
kernel-modules
kernel-modules-extra
dracut-live
glibc-all-langpacks
livesys-scripts
anaconda-live
anaconda-webui
pipewire
wireplumber
bluez
NetworkManager-wifi
flatpak
xdg-user-dirs

dashi
dashi-greeter
dashi-live
dashi-release
dashi-logos
dashi-kernel
dashi-nvidia
dashi-helium
dashi-bun
mirin-metal-host

# Dashi's release replaces Fedora's.
-fedora-release
-fedora-release-common
-fedora-release-identity-basic
-fedora-logos
%end

%post --erroronfail
# The live session: livesys-scripts runs livesys-dashi (dashi-live) at boot.
systemctl enable livesys.service livesys-late.service
echo 'livesys_session="dashi"' > /etc/sysconfig/livesys
# Dashi's login screen and boot splash.
systemctl enable greetd.service
plymouth-set-default-theme dashi || :
# The image boots the kernel Dashi prefers (dashi-kernel).
/usr/libexec/dashi/default-kernel || :
%end
