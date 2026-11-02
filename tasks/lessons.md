
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
