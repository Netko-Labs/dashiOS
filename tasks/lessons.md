
## A second wl_seat breaks single-seat clients

GPUI (so every Metal surface: the shell, the greeter) binds each `wl_seat` it
is told of and keeps the last, and rebinds when a new one appears. The agent
seat, created at startup, silently took every Metal surface's keyboard: keys
reached the compositor and went to the right surface, on a seat nobody
listened to. Verify typing into a Metal surface (the greeter, the launcher)
after any change to seats or keyboard globals; foot and xterm are not enough.
