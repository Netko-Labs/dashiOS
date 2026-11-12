# Dashi's Terminal: what zsh tells it. OSC 7 names the folder; OSC 133
# marks where each prompt starts (A), where the command is typed (B), where
# its output starts (C, with the command line) and how it ended (D, with
# its status). The Terminal names tabs by them, jumps between prompts
# (❖↑ ❖↓) and marks failed commands in the margin. Loaded once, by .zshenv.

(( ${+_dashi_hooked} )) && return 0
builtin typeset -g _dashi_hooked=1
# A command ran since the last prompt (an Enter on an empty line runs none).
builtin typeset -gi _dashi_ran=0

# $1 percent-encoded byte by byte, into REPLY (a folder or a command line in a URL).
_dashi_url() {
  builtin emulate -L zsh
  builtin local LC_ALL=C c
  REPLY=
  for c in ${(s::)1}; do
    if [[ $c == [A-Za-z0-9/._~-] ]]; then
      REPLY+=$c
    else
      builtin printf -v c '%%%02X' "'$c"
      REPLY+=$c
    fi
  done
}

_dashi_precmd() {
  builtin local code=$?
  if (( _dashi_ran )); then
    builtin printf '\e]133;D;%d\a' $code
    _dashi_ran=0
  fi
  _dashi_url $PWD
  builtin printf '\e]7;file://%s%s\a' ${HOST-} $REPLY
  builtin printf '\e]133;A\a'
  # B goes at the prompt's end, where the command is typed; a theme that
  # rebuilds PS1 before each prompt gets it again.
  [[ $PS1 == *$'\e]133;B\a'* ]] || PS1+=$'%{\e]133;B\a%}'
  # Last, after the precmd hooks loaded later (a theme's), so B lands on the PS1 they leave.
  if [[ ${precmd_functions[-1]} != _dashi_precmd ]]; then
    precmd_functions=(${precmd_functions:#_dashi_precmd} _dashi_precmd)
  fi
}

_dashi_preexec() {
  _dashi_ran=1
  _dashi_url $1
  builtin printf '\e]133;C;cmdline_url=%s\a' $REPLY
}

builtin typeset -ag precmd_functions preexec_functions
precmd_functions+=(_dashi_precmd)
preexec_functions+=(_dashi_preexec)
