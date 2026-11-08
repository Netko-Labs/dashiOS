# The Slash bar's protocol (clean-room spec)

**Source.** The facts below were read from **asusctl** (asusd, its CLI and
rog-control-center), <https://github.com/OpenGamingCollective/asusctl>,
version 6.5.0 (`git describe`: `6.5.0-27-gecd393de`), commit
`ecd393de729775a58fb93e48677ee483008b8dd9` (2026-11-07). asusctl is licensed
**MPL-2.0**. The packet bytes and the animation numbers were also checked
against gitlab.com/asus-linux/asusctl tag 6.3.8 and are the same there.
Files read: `rog-slash/src/usb.rs`, `rog-slash/src/data.rs`,
`asusd/src/aura_slash/` (`mod.rs`, `config.rs`, `trait_impls.rs`),
`asusd/src/aura_types.rs`, `asusd/src/aura_manager.rs`,
`rog-platform/src/hid_raw.rs`, `rog-platform/src/usb_raw.rs`,
`asusctl/src/slash_cli.rs`, `rog-control-center/ui/pages/slash.slint`.

**This document contains no code** from asusctl or from Dashi's earlier port:
only facts (device ids, byte values, lengths, orderings, ranges, names) in
prose and tables. It is the only input for implementing
`crates/dashi-hardware/src/slash/packet.rs`. Dashi's callers of that file
(`bar.rs`, `settings.rs`, `device.rs`, `mod.rs`) are Dashi's own MIT code and
may be read freely.

All numbers are hexadecimal when written `0x..` or as bare two-digit byte
pairs in vectors; everything else is decimal.

## 1. The device

The Slash bar is the light strip on the lid of some 2024-and-later ASUS ROG
laptops. It has no kernel driver of its own; it is reached as a USB HID
device through Linux's hidraw interface. On the 2025 Zephyrus G14 (board
`GA403WR`) it answers on the same USB device as the internal keyboard (an
ITE controller; Dashi's captured `uevent` reads
`HID_ID=0003:00000B05:000019B6`, interface `input0`, driver `asus`).

### USB ids and generations

The vendor id is always **`0x0b05`** (ASUSTeK). There are two product ids,
and the product id alone decides the report id (below):

| Product id | Report id | Laptops (board-name families, model year as asusctl names it) |
|---|---|---|
| `0x193b` | `0x5e` | GA403 (2024, Zephyrus G14 2024), GU605 (2024, Zephyrus G16 2024) |
| `0x19b6` | `0x5d` | GA403 (2025, Zephyrus G14 2025), GA605 (2024 and 2025), GU605 (2025), GU405 (2026), GU606 (2026), G614 (2025, Strix G16 2025) |

Two generations, then, as far as bytes go: the **first** (`0x193b`, report
`0x5e`) and the **later** one (`0x19b6`, report `0x5d`). Every packet below
is identical between them except byte 0, the report id. asusctl uses
`0x5d` for any laptop it does not recognise; Dashi's rule is "`0x5e` for
product `0x193b`, `0x5d` for every other product".

For reference only (Dashi takes the USB id from its model database instead):
asusd decides which of these a laptop is from the DMI board name, upper-cased,
by substring, first match wins, in this order:

| Board name contains | Family / year | Product |
|---|---|---|
| `G614F` | G614 2025 | `0x19b6` |
| `GA403W`, `GA403UH`, `GA403UM`, `GA403UP` or `GA403GM` | GA403 2025 | `0x19b6` |
| `GA403` (any other) | GA403 2024 | `0x193b` |
| `GA605K` | GA605 2025 | `0x19b6` |
| `GA605` (any other) | GA605 2024 | `0x19b6` |
| `GU405` | GU405 2026 | `0x19b6` |
| `GU606` | GU606 2026 | `0x19b6` |
| `GU605C` | GU605 2025 | `0x19b6` |
| `GU605` (any other) | GU605 2024 | `0x193b` |
| none of these | not supported | none |

### Transport

- asusd opens the device's `/dev/hidrawN` node **write-only** and writes each
  packet with a single `write()` of exactly the packet's bytes. Byte 0 of
  every packet is the report id; the rest follows it directly.
- **Lengths are part of the protocol.** Some packets are 32 bytes, zero
  padded to 32; the others are short (6, 7, 12 or 13 bytes) and are written
  at that length, **not** padded. The table in section 2 gives each one's
  length.
- Nothing is ever read back: no acknowledgement, no status, no feature-report
  get. The bar's state can't be queried.
- No delays: asusd writes packets back to back, one after the other, with
  no sleep between them and no waiting.
- Which hidraw node: asusd takes a hidraw node whose parent USB device has
  `idVendor` `0b05` and the right `idProduct`; it does not look at the
  interface number or the report descriptor. (Dashi's `device.rs` prefers the
  node whose report descriptor declares the report id; that is Dashi's own
  choice.)
- asusd also has a fallback without hidraw, which Dashi does not use: a USB
  control transfer, class request to the interface (request type `0x21`),
  request `0x09` (SET_REPORT), value `0x035e`, index `0`, timeout 200 ms,
  after resetting the device and claiming interface 0. The packet bytes are
  the same.

## 2. The messages

Ten kinds of packet. "Report" means the report id from section 1
(`0x5d` or `0x5e`). Offsets are from 0. Bytes not listed in a 32-byte packet
are `0x00` up to offset 31.

| Message | Length | Padded |
|---|---|---|
| Init, first | 32 | yes |
| Init, second | 32 | yes |
| On/off | 32 | yes |
| Save | 32 | yes |
| Animation (mode) | 32 | yes |
| Options (on, brightness, interval) | 13 | no |
| Show at boot | 12 | no |
| Show at shutdown | 12 | no |
| Show while asleep | 12 | no |
| Show the low-battery warning | 12 | no |
| Show on battery | 6 | no |
| Show with the lid closed | 7 | no |

The meaning of the constant bytes is not documented in the source; send them
exactly as given.

### 2.1 Init (two packets, in this order)

Needed once after the laptop boots, before anything else.

First packet:

| Offset | Value |
|---|---|
| 0 | report |
| 1 | `0xd7` |
| 2 | `0x00` |
| 3 | `0x00` |
| 4 | `0x01` |
| 5 | `0xac` |
| 6–31 | `0x00` |

Second packet:

| Offset | Value |
|---|---|
| 0 | report |
| 1 | `0xd2` |
| 2 | `0x02` |
| 3 | `0x01` |
| 4 | `0x08` |
| 5 | `0xab` |
| 6–31 | `0x00` |

### 2.2 On/off

| Offset | Meaning | Value |
|---|---|---|
| 0 | report | `0x5d` / `0x5e` |
| 1 | | `0xd8` |
| 2 | | `0x02` |
| 3 | | `0x00` |
| 4 | | `0x01` |
| 5 | on or off | `0x00` = on, `0x80` = off |
| 6–31 | padding | `0x00` |

### 2.3 Save

Makes the bar keep what it was just sent. asusd sends it right after an
animation packet (when the animation is changed, not at start-up) and right
after the lid-closed packet.

| Offset | Value |
|---|---|
| 0 | report |
| 1 | `0xd4` |
| 2 | `0x00` |
| 3 | `0x00` |
| 4 | `0x01` |
| 5 | `0xab` |
| 6–31 | `0x00` |

### 2.4 Animation (mode)

| Offset | Meaning | Value |
|---|---|---|
| 0 | report | `0x5d` / `0x5e` |
| 1 | | `0xd3` |
| 2 | | `0x04` |
| 3 | | `0x00` |
| 4 | | `0x0c` |
| 5 | | `0x01` |
| 6 | the animation | its byte, section 3 |
| 7 | | `0x02` |
| 8 | | `0x19` (always; see below) |
| 9 | | `0x03` |
| 10 | | `0x13` |
| 11 | | `0x04` |
| 12 | | `0x11` |
| 13 | | `0x05` |
| 14 | | `0x12` |
| 15 | | `0x06` |
| 16 | | `0x13` |
| 17–31 | padding | `0x00` |

(Offsets 5–16 read as six pairs of "slot number 1–6, value"; only slot 1, the
animation, varies.)

- Offset 8 is `0x19` for every model. The source carries a note that the
  GA605 would want `0x10` there, but asusd sends `0x19` to all models,
  GA605 included; Dashi does the same.
- asusd also builds a *first* animation packet (report, `0xd2`, `0x03`,
  `0x00`, `0x0c`, then zeros to 32) but **never sends it**; only the packet
  above is sent. Dashi doesn't send it either.

### 2.5 Options: on, brightness, interval (13 bytes, not padded)

| Offset | Meaning | Value |
|---|---|---|
| 0 | report | `0x5d` / `0x5e` |
| 1 | | `0xd3` |
| 2 | | `0x03` |
| 3 | | `0x01` |
| 4 | | `0x08` |
| 5 | | `0xab` |
| 6 | | `0xff` |
| 7 | | `0x01` |
| 8 | on or off | `0x01` = on, `0x00` = off (note: the opposite encoding from 2.2) |
| 9 | | `0x06` |
| 10 | brightness | `0x00`–`0xff`, sent as is |
| 11 | | `0xff` |
| 12 | interval | the pause between plays, sent as is (0 shortest; see section 4) |

### 2.6 When the bar shows: the six flags

Each flag has a packet of its own. "On" means the bar does show at that
moment (the person's setting is true).

**Four 12-byte flags** share one shape:

| Offset | Meaning | Boot | Shutdown | Sleep | Low-battery warning |
|---|---|---|---|---|---|
| 0 | report | report | report | report | report |
| 1 | | `0xd3` | `0xd3` | `0xd3` | `0xd3` |
| 2 | | `0x03` | `0x03` | `0x03` | `0x03` |
| 3 | | `0x01` | `0x01` | `0x01` | `0x01` |
| 4 | | `0x08` | `0x08` | `0x08` | `0x08` |
| 5 | which flag | `0xa0` | `0xa4` | `0xa1` | `0xa2` |
| 6 | | `0x04` | `0x05` | `0x00` | `0x01` |
| 7 | | `0xff` | `0xff` | `0xff` | `0xff` |
| 8 | the flag | on `0x01`, off `0x00` | on `0x01`, off `0x00` | **inverted**: on `0x00`, off `0x01` | on `0x01`, off `0x00` |
| 9 | | `0x01` | `0x01` | `0x02` | `0x02` |
| 10 | | `0xff` | `0xff` | `0xff` | `0xff` |
| 11 | | `0x00` | `0x00` | `0xff` | `0xff` |

The sleep flag is sent inverted: showing while asleep is `0x00`, not showing
is `0x01`. That is what asusd sends; whether the firmware means it that way
was not verifiable from the source.

**Show on battery** (6 bytes):

| Offset | Meaning | Value |
|---|---|---|
| 0 | report | `0x5d` / `0x5e` |
| 1 | | `0xd8` |
| 2 | | `0x01` |
| 3 | | `0x00` |
| 4 | | `0x01` |
| 5 | the flag | on `0x00`, off `0x80` |

asusd's own name for this packet is about battery *saver*; its setting and
D-Bus property are "show on battery". Dashi's key is `showOnBattery`.

**Show with the lid closed** (7 bytes):

| Offset | Meaning | Value |
|---|---|---|
| 0 | report | `0x5d` / `0x5e` |
| 1 | | `0xd8` |
| 2 | | `0x00` |
| 3 | | `0x00` |
| 4 | | `0x02` |
| 5 | | `0xa5` |
| 6 | the flag | on `0x00`, off `0x80` |

asusd follows the lid-closed packet with a save packet (2.3).

## 3. The animations

The animation byte goes at offset 6 of the animation packet. asusctl lists
them in this order; Dashi's names (lower case, words joined with `-`) and
this order are what `Slash()` reports as `modes` (docs/hardware.md), so keep
both.

| # | asusctl's name | Dashi's name | Byte |
|---|---|---|---|
| 1 | Static | `static` | `0x06` |
| 2 | Bounce | `bounce` | `0x10` |
| 3 | Slash | `slash` | `0x12` |
| 4 | Loading | `loading` | `0x13` |
| 5 | BitStream | `bit-stream` | `0x1d` |
| 6 | Transmission | `transmission` | `0x1a` |
| 7 | Flow | `flow` | `0x19` |
| 8 | Flux | `flux` | `0x25` |
| 9 | Phantom | `phantom` | `0x24` |
| 10 | Spectrum | `spectrum` | `0x26` |
| 11 | Hazard | `hazard` | `0x32` |
| 12 | Interfacing | `interfacing` | `0x33` |
| 13 | Ramp | `ramp` | `0x34` |
| 14 | GameOver | `game-over` | `0x42` |
| 15 | Start | `start` | `0x43` |
| 16 | Buzzer | `buzzer` | `0x44` |

Sixteen animations; no other byte is valid (asusd rejects any other value).
Name lookup is exact and case-sensitive on Dashi's side (`Bounce` is not a
name; `bounce` is).

## 4. Values, ranges and defaults

| Setting | Range | Notes |
|---|---|---|
| Brightness | 0–255 | One byte. asusctl's CLI and GUI offer 0–255. |
| Interval | 0–5 | The CLI says 0–5 and the GUI slider is 0–5; asusd's D-Bus property takes any byte and sends it unchecked. Dashi clamps to 0–5 before building a packet. |
| Animation | the 16 bytes in section 3 | |
| Flags | on / off | |

asusd's defaults (a laptop asusd has never configured): on, brightness 255,
interval 0, animation Bounce (`0x10`), all six flags on.

## 5. Sequences and ordering (asusd's behaviour)

No timing requirements beyond order: packets go one after another.

**Start-up** (asusd, once per boot, when it finds the bar), in this order:

1. Init, first packet.
2. Init, second packet.
3. On/off, from the saved setting.
4. Options (on, brightness, interval), from the saved settings.
5. Animation, from the saved setting (no save packet after it here).

then, when it starts its D-Bus service, a reload:

6. Options again.
7. Show at boot.
8. Show while asleep.
9. Show at shutdown.
10. Show on battery.
11. Show the low-battery warning.

Neither the lid-closed flag nor a save packet is sent at start-up.

**Changing one setting** (asusd's D-Bus property setters):

| Change | Packets, in order | Other effects |
|---|---|---|
| On/off | on/off packet, then options | Turning on while the stored brightness is 0 sends (and stores) brightness `0x88`. |
| Brightness | options only (no on/off packet) | The "on" byte in options is "brightness > 0"; asusd stores enabled = brightness > 0. |
| Interval | options | Uses the stored on and brightness. |
| Animation | animation, then save | |
| Show at boot / shutdown / while asleep / on battery / low-battery warning | that flag's packet | |
| Show with the lid closed | lid-closed packet, then save | |

Dashi's own sequencing (`settings.rs`, `bar.rs`) follows this per property
and is not part of `packet.rs`.

## 6. Test vectors

Hex, space-separated, exactly as written to the device (byte 0 first).

### Report id from product id

| Product | Report id |
|---|---|
| `0x193b` | `5e` |
| `0x19b6` | `5d` |
| `0x1234` (anything else) | `5d` |

### Init

Report `5d`:

```
5d d7 00 00 01 ac 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
5d d2 02 01 08 ab 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```

Report `5e`:

```
5e d7 00 00 01 ac 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
5e d2 02 01 08 ab 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```

### On/off

```
5d, on : 5d d8 02 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
5d, off: 5d d8 02 00 01 80 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
5e, on : 5e d8 02 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
5e, off: 5e d8 02 00 01 80 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```

### Save

```
5d: 5d d4 00 00 01 ab 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
5e: 5e d4 00 00 01 ab 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```

### Animation

Every animation, report `5d` (only offset 6 changes):

```
static      : 5d d3 04 00 0c 01 06 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
bounce      : 5d d3 04 00 0c 01 10 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
slash       : 5d d3 04 00 0c 01 12 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
loading     : 5d d3 04 00 0c 01 13 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
bit-stream  : 5d d3 04 00 0c 01 1d 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
transmission: 5d d3 04 00 0c 01 1a 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
flow        : 5d d3 04 00 0c 01 19 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
flux        : 5d d3 04 00 0c 01 25 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
phantom     : 5d d3 04 00 0c 01 24 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
spectrum    : 5d d3 04 00 0c 01 26 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
hazard      : 5d d3 04 00 0c 01 32 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
interfacing : 5d d3 04 00 0c 01 33 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
ramp        : 5d d3 04 00 0c 01 34 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
game-over   : 5d d3 04 00 0c 01 42 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
start       : 5d d3 04 00 0c 01 43 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
buzzer      : 5d d3 04 00 0c 01 44 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```

Report `5e`, a few:

```
static      : 5e d3 04 00 0c 01 06 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
bounce      : 5e d3 04 00 0c 01 10 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
buzzer      : 5e d3 04 00 0c 01 44 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```

### Options (13 bytes)

| Report | On | Brightness | Interval | Bytes |
|---|---|---|---|---|
| `5d` | on | 255 | 0 | `5d d3 03 01 08 ab ff 01 01 06 ff ff 00` |
| `5d` | on | 0 | 5 | `5d d3 03 01 08 ab ff 01 01 06 00 ff 05` |
| `5d` | off | 0 | 0 | `5d d3 03 01 08 ab ff 01 00 06 00 ff 00` |
| `5d` | off | 255 | 0 | `5d d3 03 01 08 ab ff 01 00 06 ff ff 00` |
| `5d` | on | 136 (`0x88`) | 3 | `5d d3 03 01 08 ab ff 01 01 06 88 ff 03` |
| `5d` | on | 1 | 5 | `5d d3 03 01 08 ab ff 01 01 06 01 ff 05` |
| `5d` | on | 128 | 1 | `5d d3 03 01 08 ab ff 01 01 06 80 ff 01` |
| `5e` | on | 255 | 0 | `5e d3 03 01 08 ab ff 01 01 06 ff ff 00` |
| `5e` | off | 0 | 0 | `5e d3 03 01 08 ab ff 01 00 06 00 ff 00` |
| `5e` | on | 0 | 5 | `5e d3 03 01 08 ab ff 01 01 06 00 ff 05` |

### Flags

| Report | Flag | Setting | Bytes |
|---|---|---|---|
| `5d` | boot | on | `5d d3 03 01 08 a0 04 ff 01 01 ff 00` |
| `5d` | boot | off | `5d d3 03 01 08 a0 04 ff 00 01 ff 00` |
| `5d` | shutdown | on | `5d d3 03 01 08 a4 05 ff 01 01 ff 00` |
| `5d` | shutdown | off | `5d d3 03 01 08 a4 05 ff 00 01 ff 00` |
| `5d` | sleep | on | `5d d3 03 01 08 a1 00 ff 00 02 ff ff` |
| `5d` | sleep | off | `5d d3 03 01 08 a1 00 ff 01 02 ff ff` |
| `5d` | low-battery warning | on | `5d d3 03 01 08 a2 01 ff 01 02 ff ff` |
| `5d` | low-battery warning | off | `5d d3 03 01 08 a2 01 ff 00 02 ff ff` |
| `5d` | on battery | on | `5d d8 01 00 01 00` |
| `5d` | on battery | off | `5d d8 01 00 01 80` |
| `5d` | lid closed | on | `5d d8 00 00 02 a5 00` |
| `5d` | lid closed | off | `5d d8 00 00 02 a5 80` |
| `5e` | boot | on | `5e d3 03 01 08 a0 04 ff 01 01 ff 00` |
| `5e` | sleep | on | `5e d3 03 01 08 a1 00 ff 00 02 ff ff` |
| `5e` | sleep | off | `5e d3 03 01 08 a1 00 ff 01 02 ff ff` |
| `5e` | on battery | off | `5e d8 01 00 01 80` |
| `5e` | lid closed | on | `5e d8 00 00 02 a5 00` |
| `5e` | lid closed | off | `5e d8 00 00 02 a5 80` |

### A whole start-up, asusd's defaults, report `5d`

Steps 1–5 of section 5 (on, brightness 255, interval 0, Bounce):

```
5d d7 00 00 01 ac 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
5d d2 02 01 08 ab 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
5d d8 02 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
5d d3 03 01 08 ab ff 01 01 06 ff ff 00
5d d3 04 00 0c 01 10 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```

## 7. The interface `packet.rs` must expose

`crates/dashi-hardware/src/slash/mod.rs` declares `mod packet;` (private to
the `slash` module). Everything below is `pub(crate)`, and is used by
`bar.rs` and `settings.rs` in the same module. Nothing else in the crate uses
`packet.rs`: `device.rs` doesn't, and the D-Bus code
(`serve/interface.rs`) and the CLI (`cli.rs`) only use `Change` and `Input`
from `settings.rs`. The function bodies build nothing but bytes: no I/O.

Every packet is returned as a `Vec<u8>` of exactly the length in section 2
(32 for the padded ones, 6/7/12/13 for the others): callers write each `Vec`
as it is.

| Item | Signature | Returns | Used in |
|---|---|---|---|
| `report_id` | `fn report_id(product: u16) -> u8` | `0x5e` when `product == 0x193b`, else `0x5d` | `bar.rs` |
| `init` | `fn init(report: u8) -> [Vec<u8>; 2]` | the two init packets, first then second (2.1). `settings.rs` turns the array into a `Vec<Vec<u8>>` with `.into()`, so it must be an array of two `Vec<u8>`. | `settings.rs` |
| `enable` | `fn enable(report: u8, on: bool) -> Vec<u8>` | the on/off packet (2.2), 32 bytes | `settings.rs` |
| `save` | `fn save(report: u8) -> Vec<u8>` | the save packet (2.3), 32 bytes | `bar.rs`, `settings.rs` |
| `mode` | `fn mode(report: u8, mode: u8) -> Vec<u8>` | the animation packet (2.4), 32 bytes; `mode` is the animation's byte | `settings.rs` |
| `options` | `fn options(report: u8, on: bool, brightness: u8, interval: u8) -> Vec<u8>` | the options packet (2.5), 13 bytes; values sent as given | `settings.rs` |
| `MODES` | `const MODES: [(&str, u8); 16]` | (Dashi's name, byte) for the 16 animations in the order of section 3. Callers iterate it with `.iter()` and take `.0` for the names. | `bar.rs`, `settings.rs` |
| `mode_byte` | `fn mode_byte(name: &str) -> Option<u8>` | the byte for a Dashi name from `MODES`, exact match; `None` for anything else | `settings.rs` |
| `Show` | `enum Show { Boot, Shutdown, Sleep, Battery, BatteryWarning, LidClosed }` | exactly these six variants (`settings.rs` matches on them exhaustively), deriving `Clone, Copy, Debug, PartialEq, Eq` (`settings::Change` derives `Clone, Debug, PartialEq, Eq` and holds `Vec<(Show, bool)>`; callers copy it and compare with `==`) | `bar.rs`, `settings.rs` |
| `Show::ALL` | `const ALL: [Show; 6]` (associated) | `[Boot, Shutdown, Sleep, Battery, BatteryWarning, LidClosed]` in this order: callers iterate it by value, and the order is the order changed flags are sent in (lid closed last, then its save) | `settings.rs` |
| `Show::key` | `fn key(self) -> &'static str` | `showOnBoot`, `showOnShutdown`, `showOnSleep`, `showOnBattery`, `showBatteryWarning`, `showOnLidClosed` (one per variant, same order) — the keys of `Slash()`'s JSON and `SetSlash`'s dictionary | `settings.rs` |
| `Show::from_key` | `fn from_key(key: &str) -> Option<Show>` | the variant whose `key()` equals `key` exactly; `None` otherwise | `settings.rs` |
| `Show::packet` | `fn packet(self, report: u8, on: bool) -> Vec<u8>` | that flag's packet (2.6): Boot, Shutdown, Sleep, BatteryWarning 12 bytes; Battery 6; LidClosed 7. `on` is the person's setting; the Sleep packet carries it inverted. | `bar.rs`, `settings.rs` |

Mapping of `Show` to section 2.6: `Boot` = show at boot, `Shutdown` = show at
shutdown, `Sleep` = show while asleep, `Battery` = show on battery,
`BatteryWarning` = the low-battery warning, `LidClosed` = show with the lid
closed.

Tests: the tests that covered the old file and Dashi's sequencing against it
were removed with it. The implementation should come with tests of every
vector in section 6, and `slash/tests.rs` should again cover what
`settings.rs` and `bar.rs` send (a change sends only what differs; the first
change sends everything: init, init, on/off, options, animation, five flags,
lid closed, save; a restore sends ten packets starting with the first init
packet).

## 8. Not pinned down

- What the constant bytes mean (the command byte at offset 1, the `0xab` /
  `0xac` / `0xff` markers, the slot pairs in the animation packet). Send them
  as given.
- Whether the sleep flag's inversion is the firmware's meaning or a quirk of
  asusd; the bytes above are what asusd sends.
- Whether the GA605 really wants `0x10` at offset 8 of the animation packet:
  the source only notes it, and sends `0x19`.
- What the never-sent first animation packet is for.
- Which hidraw interface the bar is on for composite devices: asusd takes
  any hidraw node of the USB device; the source says nothing about interface
  numbers or report descriptors.
- Interval: what the firmware does above 5 (asusd passes any byte through;
  only its CLI and GUI limit it to 0–5), and how long each step is.
- Brightness: whether the steps are linear, and whether 0 with "on" is
  dark or off (asusd treats brightness 0 as off).
