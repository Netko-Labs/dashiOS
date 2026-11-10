//! The command line: `dashi-comp [--backend NAME] [--greeter] [--no-xwayland] [--open-ipc] [-c COMMAND]`.

pub(crate) const USAGE: &str = "\
usage: dashi-comp [--backend auto|udev|winit|headless] [--greeter] [--no-xwayland]
                  [--open-ipc] [-c COMMAND]

  -c COMMAND        run COMMAND (a shell command line) as the session's client;
                    the compositor ends when it does
  --backend NAME    udev: the screens and input of this seat (DRM, libinput);
                    winit: in a window of the session this runs in;
                    headless: no screens drawn (tests);
                    auto (default): winit when nested, else udev
  --greeter         the login screen's compositor: no Xwayland, and no
                    window list or screen copying for anyone
  --no-xwayland     no X11 apps (headless never starts Xwayland)
  --open-ipc        trust every IPC connection as the shell (tests, a shell
                    started by hand); never for a session
  -h, --help        this
  -V, --version     the version
";

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum BackendChoice {
    Auto,
    Udev,
    Winit,
    Headless,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Args {
    pub command: Option<String>,
    pub backend: BackendChoice,
    pub greeter: bool,
    pub xwayland: bool,
    pub open_ipc: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Parsed {
    Run(Args),
    Help,
    Version,
}

pub(crate) fn parse(mut args: impl Iterator<Item = String>) -> Result<Parsed, String> {
    let mut parsed = Args {
        command: None,
        backend: BackendChoice::Auto,
        greeter: false,
        xwayland: true,
        open_ipc: false,
    };
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Parsed::Help),
            "-V" | "--version" => return Ok(Parsed::Version),
            "--greeter" => parsed.greeter = true,
            "--no-xwayland" => parsed.xwayland = false,
            "--open-ipc" => parsed.open_ipc = true,
            "-c" | "--command" => parsed.command = Some(args.next().ok_or("-c needs a command")?),
            "--backend" => {
                parsed.backend = match args.next().as_deref() {
                    Some("auto") => BackendChoice::Auto,
                    Some("udev") => BackendChoice::Udev,
                    Some("winit") => BackendChoice::Winit,
                    Some("headless") => BackendChoice::Headless,
                    Some(other) => return Err(format!("unknown backend {other:?}")),
                    None => return Err("--backend needs a name".into()),
                }
            }
            other => return Err(format!("unknown argument {other:?}")),
        }
    }
    Ok(Parsed::Run(parsed))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(args: &[&str]) -> Result<Parsed, String> {
        parse(args.iter().map(|s| s.to_string()))
    }

    #[test]
    fn a_command_and_a_backend() {
        assert_eq!(
            run(&["--backend", "headless", "-c", "'bun' 'session.ts'"]),
            Ok(Parsed::Run(Args {
                command: Some("'bun' 'session.ts'".into()),
                backend: BackendChoice::Headless,
                greeter: false,
                xwayland: true,
                open_ipc: false,
            }))
        );
        assert_eq!(
            run(&[]),
            Ok(Parsed::Run(Args {
                command: None,
                backend: BackendChoice::Auto,
                greeter: false,
                xwayland: true,
                open_ipc: false,
            }))
        );
    }

    #[test]
    fn greeter_and_xwayland_switches() {
        let Ok(Parsed::Run(args)) = run(&["--greeter", "--no-xwayland", "--open-ipc"]) else {
            panic!("the switches parse");
        };
        assert!(args.greeter && !args.xwayland && args.open_ipc);
    }

    #[test]
    fn mistakes_say_what() {
        assert!(run(&["-c"]).is_err());
        assert!(run(&["--backend", "x11"]).unwrap_err().contains("x11"));
        assert!(run(&["--frobnicate"]).is_err());
        assert_eq!(run(&["--help", "--bogus"]), Ok(Parsed::Help));
    }
}
