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
# Terra (Fyra Labs): on by default on Dashi; terra-release below installs its repo file and key.
repo --name=dashi-image-terra --baseurl=https://repos.fyralabs.com/terra$releasever
repo --name=dashi-image-local --baseurl=@DASHI_REPO@ --cost=10

# Fedora 44's crypto-policies has a /bin/sh %pre, and rpm can order it before
# glibc in a fresh root (its loop breaking shifts with every update; it did
# on 2026-11-02 and the image stopped building), so the shell can't run yet.
# Seed the empty root with the build host's bash and the libraries it loads,
# in %pre-install (on the build host, once the root is mounted; a %pre runs
# before that and its files end up hidden under the mount); bash, glibc,
# ncurses-libs, and filesystem replace them all during the transaction.
%pre-install --erroronfail
root=${ANA_INSTALL_PATH:-/mnt/sysimage}
mkdir -p "$root/usr/bin" "$root/usr/lib64"
[ -e "$root/bin" ] || ln -s usr/bin "$root/bin"
[ -e "$root/lib64" ] || ln -s usr/lib64 "$root/lib64"
cp -p /usr/bin/bash "$root/usr/bin/bash"
[ -e "$root/usr/bin/sh" ] || ln -s bash "$root/usr/bin/sh"
for lib in ld-linux-x86-64.so.2 libc.so.6 libtinfo.so.6; do
  cp -pL "/usr/lib64/$lib" "$root/usr/lib64/$lib"
done
%end

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
# checkisomd5, for GRUB's default "Test this media" entry (rd.live.check).
isomd5sum
# What lorax needs to make the ISO bootable (BIOS and UEFI).
grub2-pc-modules
grub2-efi-x64
grub2-efi-x64-cdboot
shim-x64
efibootmgr
syslinux
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
zsh

dashi
dashi-greeter
dashi-live
dashi-release
terra-release
dashi-logos
dashi-kernel
dashi-nvidia
dashi-helium
dashi-bun
mirin-metal-host
# The Terminal: its engine, on Ghostty's terminal core.
dashi-term
libghostty-vt

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
# greetd is wanted by graphical.target; the image otherwise boots to a text login.
systemctl set-default graphical.target
plymouth-set-default-theme dashi || :
# The image boots the kernel Dashi prefers (dashi-kernel).
/usr/libexec/dashi/default-kernel || :
%end
