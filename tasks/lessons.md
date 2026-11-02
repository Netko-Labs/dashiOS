
## A second wl_seat breaks single-seat clients

GPUI (so every Metal surface: the shell, the greeter) binds each `wl_seat` it
is told of and keeps the last, and rebinds when a new one appears. The agent
seat, created at startup, silently took every Metal surface's keyboard: keys
reached the compositor and went to the right surface, on a seat nobody
listened to. Verify typing into a Metal surface (the greeter, the launcher)
after any change to seats or keyboard globals; foot and xterm are not enough.

## Boot the image, not just the packages, on a plain GPU

The installed system and the dev VM had always run on a 3D-capable virtio GPU,
so three image bugs hid until the ISO was booted in a separate QEMU with a
plain `virtio-vga`: the image's default target was `multi-user.target` (greetd
never ran), GRUB's default "Test this media" entry failed without `isomd5sum`,
and dashi-comp skipped a GPU with only a software EGL driver. Before calling
an image done, boot it headless (`-device virtio-vga -display none`, QMP
`screendump`) through GRUB's default entry to the desktop.

## Look for a file's owner before adding it to another package

An Anaconda profile was added to dashi-live while dashi-release already
shipped one at the same path; nothing complained until the image build's
package transaction, twenty minutes in. Before adding a file under /etc or
/usr, search spin/ for the path (`grep -r` the path across spin/rpm and the
spin/<package> trees). spin/build-rpms now refuses packages that share a
file.

## Overnight runs: the clean-tree check and swept logs

spin/build-rpms builds from HEAD and refuses a dirty tree; an edit made while
a chained build is queued stops it, and the chain's next step then runs on
old packages. Commit before starting a chained build, and give each step an
exit check. livemedia-creator's Anaconda moves /tmp/*.log into the image's
anaconda/ folder: write build logs under the home directory.
