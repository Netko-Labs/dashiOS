# Dashi's Terminal: bash's shell integration, loaded without touching your
# own files. dashi-term starts bash with --posix and ENV pointing here: in
# POSIX mode bash reads only $ENV. This turns POSIX mode off, reads the files
# bash would have read (/etc/profile and the first of ~/.bash_profile,
# ~/.bash_login and ~/.profile for a login shell, else ~/.bashrc), then says
# what the Terminal needs: OSC 7 names the folder; OSC 133 marks the prompt
# (A), where the command is typed (B), where its output starts (C, with the
# command line) and how it ended (D, with its status).

if [ -n "${DASHI_BASH_INJECT-}" ]; then
  builtin unset ENV DASHI_BASH_INJECT
  if [ -n "${DASHI_BASH_ENV+set}" ]; then
    builtin export ENV="$DASHI_BASH_ENV"
    builtin unset DASHI_BASH_ENV
  fi
  builtin set +o posix
  if builtin shopt -q login_shell; then
    [ -r /etc/profile ] && builtin source /etc/profile
    for _dashi_own in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
      if [ -r "$_dashi_own" ]; then
        builtin source "$_dashi_own"
        break
      fi
    done
    builtin unset _dashi_own
  elif [ -r "$HOME/.bashrc" ]; then
    builtin source "$HOME/.bashrc"
  fi
fi

if [[ $- == *i* && -z ${_dashi_hooked-} ]]; then
  _dashi_hooked=1

  # $1 percent-encoded byte by byte (a folder or a command line in a URL).
  _dashi_url() {
    local LC_ALL=C text="$1" out='' c i
    for ((i = 0; i < ${#text}; i++)); do
      c=${text:i:1}
      case $c in
      [A-Za-z0-9/._~-]) out+=$c ;;
      *) builtin printf -v c '%%%02X' "'$c" && out+=$c ;;
      esac
    done
    builtin printf '%s' "$out"
  }

  # The command line that is about to run, for C: the newest history entry.
  _dashi_command() {
    local line
    line=$(HISTTIMEFORMAT='' builtin history 1)
    line=${line#*[0-9] }
    builtin printf '\e]133;C;cmdline_url=%s\a' "$(_dashi_url "${line# }")"
  }

  _dashi_ran=0
  _dashi_prompt() {
    local code=$?
    if ((_dashi_ran)); then
      builtin printf '\e]133;D;%d\a' "$code"
      _dashi_ran=0
    fi
    builtin printf '\e]7;file://%s%s\a' "${HOSTNAME-}" "$(_dashi_url "$PWD")"
    builtin printf '\e]133;A\a'
    [[ $PS1 == *'133;B'* ]] || PS1+='\[\e]133;B\a\]'
    # PS0 is drawn by this shell as a command starts (an empty Enter starts
    # none): the subscript notes that one ran (it expands to nothing), and
    # the substitution says C with its command line.
    [[ $PS0 == *_dashi_command* ]] || PS0+='${_dashi_none[_dashi_ran=1]}$(_dashi_command)'
    return $code
  }

  # First, so it sees the command's status before anything else runs.
  if [[ $(builtin declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a"* ]]; then
    PROMPT_COMMAND=(_dashi_prompt "${PROMPT_COMMAND[@]}")
  else
    PROMPT_COMMAND="_dashi_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
  fi
fi
