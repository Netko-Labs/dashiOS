#!/usr/bin/sh
# The bridge against libsecret, on a private session bus, with a development
# vault (no root, no PAM): store, look up, replace, search, clear, and a
# caller in an agent's scope refused. Needs dbus-run-session, secret-tool,
# python3 and systemd-run --user.
#
#   cargo build -p dashi-secretd
#   dbus-run-session -- sh crates/dashi-secretd/tests/bridge-secret-tool.sh <empty dir> target/debug
set -u
S=$1; T=$2
send() { python3 -I -c 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); s.sendall(sys.argv[2].encode()+b"\n"); print(s.makefile().readline().strip())' "$S/sock" "$1"; }
"$T/dashi-secretd" --dev --state "$S/state" --socket "$S/sock" 2>"$S/d.log" &
D=$!
sleep 0.5
send "{\"op\":\"unlock\",\"user\":$(id -u),\"password\":\"cHc=\"}"
"$T/dashi-secret-bridge" --socket "$S/sock" 2>"$S/b.log" &
B=$!
sleep 0.7
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 (got [$2], wanted [$3])"; fail=1; fi; }
printf s3cr3t-value | secret-tool store --label="Test item" service dashi-test user alexk
check "stored and found" "$(secret-tool lookup service dashi-test user alexk)" "s3cr3t-value"
printf second | secret-tool store --label="Test item" service dashi-test user alexk
check "replaced" "$(secret-tool lookup service dashi-test user alexk)" "second"
check "searched" "$(secret-tool search --all service dashi-test 2>/dev/null | grep -c '^secret = second')" "1"
secret-tool clear service dashi-test user alexk
check "cleared" "$(secret-tool lookup service dashi-test user alexk)" ""
printf again | secret-tool store --label="Agent bait" service dashi-test user alexk
check "an agent's scope is refused" \
  "$(systemd-run --user --scope --quiet --unit="dashi-agent-test-$$" -- secret-tool lookup service dashi-test user alexk 2>&1)" \
  "secret-tool: agents may not use the Secret Service; ask the person through Dashi"
kill $B $D
exit $fail
