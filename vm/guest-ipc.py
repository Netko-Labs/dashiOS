"""One request to the compositor's IPC socket, run in the guest by `vm/vm ipc`
(fed on stdin): prints the result as JSON, exits 1 on an error reply."""

import json
import os
import socket
import sys

method, params = sys.argv[1], json.loads(sys.argv[2] if len(sys.argv) > 2 else "{}")
runtime = os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
connection = socket.socket(socket.AF_UNIX)
connection.settimeout(30)
connection.connect(os.path.join(runtime, "dashi-comp.sock"))
stream = connection.makefile("rw")
stream.write(json.dumps({"id": 1, "method": method, "params": params}) + "\n")
stream.flush()
for line in stream:
    reply = json.loads(line)
    if reply.get("id") == 1:
        print(json.dumps(reply.get("result", reply)))
        sys.exit(1 if "error" in reply else 0)
