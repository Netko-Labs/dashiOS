# Dashi's Terminal: zsh's shell integration, loaded without touching your
# own files. dashi-term starts zsh with ZDOTDIR pointing here (and the one
# you had in DASHI_ZSH_ZDOTDIR); this puts yours back, reads your .zshenv as
# zsh would have, then loads the integration in an interactive shell. zsh
# reads .zprofile, .zshrc and .zlogin from your ZDOTDIR afterwards, as ever.

if [[ -n ${DASHI_ZSH_ZDOTDIR+set} ]]; then
  ZDOTDIR=$DASHI_ZSH_ZDOTDIR
  builtin unset DASHI_ZSH_ZDOTDIR
else
  builtin unset ZDOTDIR
fi

{
  builtin typeset _dashi_own=${ZDOTDIR-$HOME}/.zshenv
  [[ ! -r $_dashi_own ]] || builtin source -- $_dashi_own
} always {
  if [[ -o interactive && -n ${DASHI_SHELL_INTEGRATION-} ]]; then
    builtin source -- $DASHI_SHELL_INTEGRATION/zsh/dashi-integration.zsh
  fi
  builtin unset _dashi_own DASHI_SHELL_INTEGRATION
}
