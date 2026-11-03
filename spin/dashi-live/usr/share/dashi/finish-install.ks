# Dashi (dashi-live): finish the installed system once Anaconda has copied the
# live image onto it, configured it, and installed the boot loader. The live
# session adds this to Anaconda's interactive-defaults.ks (livesys-dashi),
# the kickstart a live install reads: its %post runs after Anaconda's own
# steps. (Anaconda's post-scripts/ directory reaches only its main process,
# not the module that runs scripts, so a %post there never runs.)
# NVIDIA's driver is built when the machine has an NVIDIA GPU (removed when
# it hasn't), and CachyOS's kernel becomes the only one where it boots
# (/usr/libexec/dashi/finish-install). A failure leaves the system as it
# was copied, which boots: Fedora's kernel too, and akmods at first boot.
%post --nochroot --log=/tmp/dashi-finish-install.log
root=${ANA_INSTALL_PATH:-/mnt/sysroot}
/usr/libexec/dashi/finish-install --root "$root" || echo "finish-install failed; the system is left as copied"
mkdir -p "$root/var/log/dashi"
cp /tmp/dashi-finish-install.log "$root/var/log/dashi/finish-install.log" 2>/dev/null || :
%end
