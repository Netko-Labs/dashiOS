//! Shell integration: the Terminal knows which folder the shell is in and
//! where each prompt, command and its output begin and end because the shell
//! says so (OSC 7, OSC 133). The scripts that make zsh, bash and fish say it
//! ship with the app (packages/shell/apps/terminal/integration, `--integration
//! DIR`); this starts the shell so it loads them without anyone editing their
//! rc files, the way Ghostty and kitty do: zsh through `ZDOTDIR`, bash
//! through POSIX mode's `ENV`, fish through `XDG_DATA_DIRS`' vendor_conf.d.
//! Each script puts back what it borrowed before it reads the person's own
//! files. Any other shell starts as it always did.

/// What starting the shell with its integration adds: arguments after its
/// name, and environment variables (set over the inherited ones).
#[derive(Debug, Default, PartialEq)]
pub(crate) struct Launch {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// fish's own default when `XDG_DATA_DIRS` is unset (the XDG spec's).
const XDG_DATA_DEFAULT: &str = "/usr/local/share:/usr/share";

/// How to start `shell` (a file name: "zsh", "bash", "fish") with the
/// scripts in `dir`. `var` reads the environment the shell would inherit.
pub(crate) fn launch(shell: &str, dir: &str, var: impl Fn(&str) -> Option<String>) -> Launch {
    let set = |pairs: &[(&str, String)]| {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), value.clone()))
            .collect::<Vec<_>>()
    };
    match shell {
        "zsh" => {
            let mut env = set(&[
                ("ZDOTDIR", format!("{dir}/zsh")),
                ("DASHI_SHELL_INTEGRATION", dir.to_string()),
            ]);
            if let Some(own) = var("ZDOTDIR") {
                env.push(("DASHI_ZSH_ZDOTDIR".into(), own));
            }
            Launch {
                args: Vec::new(),
                env,
            }
        }
        "bash" => {
            let mut env = set(&[
                ("ENV", format!("{dir}/bash/dashi.bash")),
                ("DASHI_BASH_INJECT", "1".to_string()),
            ]);
            if let Some(own) = var("ENV") {
                env.push(("DASHI_BASH_ENV".into(), own));
            }
            Launch {
                args: vec!["--posix".into()],
                env,
            }
        }
        "fish" => {
            let data = var("XDG_DATA_DIRS")
                .filter(|dirs| !dirs.is_empty())
                .unwrap_or_else(|| XDG_DATA_DEFAULT.to_string());
            Launch {
                args: Vec::new(),
                env: set(&[
                    ("XDG_DATA_DIRS", format!("{dir}:{data}")),
                    ("DASHI_FISH_XDG_DIR", dir.to_string()),
                ]),
            }
        }
        _ => Launch::default(),
    }
}

/// The folder an OSC 7 names: `file://host/path` with the path
/// percent-decoded, and the host ("" for none). A bare path (OSC 9 and 1337
/// send them) is a path on no named host. None for anything else.
pub(crate) fn folder(uri: &str) -> Option<(String, String)> {
    if uri.starts_with('/') {
        return Some((uri.to_string(), String::new()));
    }
    let rest = uri.strip_prefix("file://")?;
    let at = rest.find('/')?;
    let (host, path) = rest.split_at(at);
    Some((percent_decoded(path)?, host.to_string()))
}

fn percent_decoded(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let hex = text.get(at + 1..at + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIR: &str = "/usr/share/dashi/shell/apps/terminal/integration";

    #[test]
    fn zsh_reads_its_own_dotfiles_after_ours() {
        let none = |_: &str| None;
        let start = launch("zsh", DIR, none);
        assert!(start.args.is_empty());
        assert!(
            start
                .env
                .contains(&("ZDOTDIR".into(), format!("{DIR}/zsh")))
        );
        assert!(!start.env.iter().any(|(key, _)| key == "DASHI_ZSH_ZDOTDIR"));
        let own = launch("zsh", DIR, |key| {
            (key == "ZDOTDIR").then(|| "/home/alexk/.config/zsh".to_string())
        });
        assert!(
            own.env
                .contains(&("DASHI_ZSH_ZDOTDIR".into(), "/home/alexk/.config/zsh".into()))
        );
    }

    #[test]
    fn bash_starts_in_posix_mode_to_read_env_first() {
        let start = launch("bash", DIR, |_| None);
        assert_eq!(start.args, vec!["--posix".to_string()]);
        assert!(
            start
                .env
                .contains(&("ENV".into(), format!("{DIR}/bash/dashi.bash")))
        );
    }

    #[test]
    fn fish_finds_ours_first_in_its_data_dirs() {
        let start = launch("fish", DIR, |_| None);
        assert!(start.env.contains(&(
            "XDG_DATA_DIRS".into(),
            format!("{DIR}:/usr/local/share:/usr/share")
        )));
        let own = launch("fish", DIR, |key| {
            (key == "XDG_DATA_DIRS").then(|| "/opt/share".to_string())
        });
        assert!(
            own.env
                .contains(&("XDG_DATA_DIRS".into(), format!("{DIR}:/opt/share")))
        );
    }

    #[test]
    fn other_shells_start_as_they_are() {
        assert_eq!(launch("nu", DIR, |_| None), Launch::default());
    }

    #[test]
    fn folders_decode() {
        assert_eq!(
            folder("file://dashi/home/alexk/My%20Files"),
            Some(("/home/alexk/My Files".into(), "dashi".into()))
        );
        assert_eq!(
            folder("file:///tmp/%C3%A9t%C3%A9"),
            Some(("/tmp/été".into(), String::new()))
        );
        assert_eq!(
            folder("/home/alexk"),
            Some(("/home/alexk".into(), String::new()))
        );
        assert_eq!(folder("https://example.com/"), None);
        assert_eq!(folder("file://host/bad%2"), None);
        assert_eq!(folder("file://host"), None);
    }
}
