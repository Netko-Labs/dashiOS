# Recorded harness streams (agents/handoff/stream.ts)

- `claude-code.jsonl`: recorded from Claude Code 2.1.319 (`claude -p --output-format stream-json --verbose`
  with a throwaway MCP server named `dashi` offering `open_url` and `read_page`), trimmed: the
  rate-limit event, thinking blocks and usage numbers taken out, the working folder replaced.
- `codex.jsonl` and `opencode.jsonl`: written from Codex's (`codex exec --json`) and OpenCode's
  (`opencode run --format json`) documented event shapes; neither was installed where this was
  written, so these are not recordings.
