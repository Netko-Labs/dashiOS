#!/usr/bin/env python3
"""vm/qmp.py: talk to the running Dashi VM over QMP (vm/images/qmp.sock).

    qmp.py SOCKET screenshot PATH.png   save what the VM's screen shows
    qmp.py SOCKET type TEXT             type TEXT on the VM's keyboard
    qmp.py SOCKET key COMBO...          press combos: ctrl-alt-t, ret, meta_l
    qmp.py SOCKET powerdown             ask the guest to shut down (ACPI)
"""

import json
import socket
import sys
import time

# Characters to QEMU key codes (qcode), US layout; shifted ones in SHIFTED.
PLAIN = {
    **{c: c for c in "abcdefghijklmnopqrstuvwxyz0123456789"},
    " ": "spc", "\n": "ret", "\t": "tab", "-": "minus", "=": "equal", "[": "bracket_left",
    "]": "bracket_right", "\\": "backslash", ";": "semicolon", "'": "apostrophe", "`": "grave_accent",
    ",": "comma", ".": "dot", "/": "slash",
}
SHIFTED = {
    **{c.upper(): c for c in "abcdefghijklmnopqrstuvwxyz"},
    "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
    "_": "minus", "+": "equal", "{": "bracket_left", "}": "bracket_right", "|": "backslash", ":": "semicolon",
    '"': "apostrophe", "~": "grave_accent", "<": "comma", ">": "dot", "?": "slash",
}
ALIASES = {"ctrl": "ctrl", "alt": "alt", "shift": "shift", "super": "meta_l", "meta": "meta_l", "enter": "ret", "esc": "esc"}


class Qmp:
    def __init__(self, path: str) -> None:
        self.sock = socket.socket(socket.AF_UNIX)
        self.sock.connect(path)
        self.file = self.sock.makefile("rw")
        self.file.readline()  # greeting
        self.call("qmp_capabilities")

    def call(self, command: str, **arguments: object) -> object:
        self.file.write(json.dumps({"execute": command, "arguments": arguments}) + "\n")
        self.file.flush()
        while True:
            reply = json.loads(self.file.readline())
            if "return" in reply:
                return reply["return"]
            if "error" in reply:
                raise SystemExit(f"qmp: {command}: {reply['error'].get('desc')}")

    def keys(self, qcodes: list[str]) -> None:
        self.call("send-key", keys=[{"type": "qcode", "data": q} for q in qcodes], **{"hold-time": 40})
        time.sleep(0.02)


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    qmp = Qmp(sys.argv[1])
    command, args = sys.argv[2], sys.argv[3:]
    if command == "screenshot" and len(args) == 1:
        qmp.call("screendump", filename=args[0], format="png")
    elif command == "type" and len(args) == 1:
        for char in args[0]:
            if char in PLAIN:
                qmp.keys([PLAIN[char]])
            elif char in SHIFTED:
                qmp.keys(["shift", SHIFTED[char]])
            else:
                raise SystemExit(f"qmp: can't type {char!r}")
    elif command == "key" and args:
        for combo in args:
            qmp.keys([ALIASES.get(part, part) for part in combo.split("-")])
    elif command == "powerdown" and not args:
        qmp.call("system_powerdown")
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
