# Dashi (dashi-live): finish the installed system once Anaconda has copied the
# live image onto it, configured it, and installed the boot loader. Anaconda
# reads every *ks here and runs these after its own steps (post-scripts).
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
