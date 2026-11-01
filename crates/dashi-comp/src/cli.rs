//! The command line: `dashi-comp [--backend winit|headless] [-c COMMAND]`.

pub(crate) const USAGE: &str = "\
usage: dashi-comp [--backend auto|winit|headless] [-c COMMAND]

  -c COMMAND        run COMMAND (a shell command line) as the session's client;
                    the compositor ends when it does
  --backend NAME    winit: in a window of the session this runs in;
                    headless: no screens drawn (tests);
                    auto (default): winit when nested, else the DRM backend (C1)
  -h, --help        this
  -V, --version     the version
";

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum BackendChoice {
    Auto,
    Winit,
    Headless,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Args {
    pub command: Option<String>,
    pub backend: BackendChoice,
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
    };
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Parsed::Help),
            "-V" | "--version" => return Ok(Parsed::Version),
            "-c" | "--command" => parsed.command = Some(args.next().ok_or("-c needs a command")?),
            "--backend" => {
                parsed.backend = match args.next().as_deref() {
                    Some("auto") => BackendChoice::Auto,
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
                backend: BackendChoice::Headless
            }))
        );
        assert_eq!(
            run(&[]),
            Ok(Parsed::Run(Args {
                command: None,
                backend: BackendChoice::Auto
            }))
        );
    }

    #[test]
    fn mistakes_say_what() {
        assert!(run(&["-c"]).is_err());
        assert!(run(&["--backend", "x11"]).unwrap_err().contains("x11"));
        assert!(run(&["--frobnicate"]).is_err());
        assert_eq!(run(&["--help", "--bogus"]), Ok(Parsed::Help));
    }
}
