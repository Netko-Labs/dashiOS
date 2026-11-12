# Dashi's Terminal: fish's shell integration, loaded without touching your
# own files. dashi-term puts the integration folder first in XDG_DATA_DIRS,
# so fish reads this from its vendor_conf.d; this puts XDG_DATA_DIRS back,
# then says what the Terminal needs: OSC 7 names the folder; OSC 133 marks
# the prompt (A), where its output starts (C, with the command line) and
# how the command ended (D, with its status).

if set --query DASHI_FISH_XDG_DIR
    set --local dirs (string split : -- $XDG_DATA_DIRS)
    if set --local at (contains --index -- $DASHI_FISH_XDG_DIR $dirs)
        set --erase dirs[$at]
    end
    if test (count $dirs) -gt 0
        set --global --export XDG_DATA_DIRS (string join : -- $dirs)
    else
        set --erase XDG_DATA_DIRS
    end
    set --erase DASHI_FISH_XDG_DIR
end

status is-interactive; or exit 0
set --query __dashi_hooked; and exit 0
set --global __dashi_hooked 1

function __dashi_prompt --on-event fish_prompt
    printf '\e]7;file://%s%s\a' (prompt_hostname) (string escape --style=url -- $PWD)
    printf '\e]133;A\a'
end

function __dashi_preexec --on-event fish_preexec
    printf '\e]133;C;cmdline_url=%s\a' (string escape --style=url -- $argv[1])
end

function __dashi_postexec --on-event fish_postexec
    printf '\e]133;D;%d\a' $status
end
