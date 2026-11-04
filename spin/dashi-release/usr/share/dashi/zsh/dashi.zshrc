# Dashi's zsh: the defaults every interactive zsh starts from (/etc/zshrc
# sources this; dashi-release adds the line). Your own ~/.zshrc runs after it
# and wins.

# History: shared between terminals, without duplicates.
HISTFILE=${HISTFILE:-~/.zsh_history}
HISTSIZE=50000
SAVEHIST=50000
setopt share_history hist_ignore_all_dups hist_reduce_blanks inc_append_history

# Completion, case-insensitive, with a menu (~/.zshrc runs compinit).
zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'

# Emacs keys (Ctrl+A, Ctrl+E, ...), and cd by typing a directory's name.
bindkey -e
setopt auto_cd interactive_comments

# A short prompt: the directory, and ❯ (red after a failed command).
autoload -Uz colors && colors
PROMPT='%F{green}%~%f %(?.%F{blue}.%F{red})❯%f '

alias ls='ls --color=auto'
alias ll='ls -lh'
alias la='ls -lAh'
alias grep='grep --color=auto'
