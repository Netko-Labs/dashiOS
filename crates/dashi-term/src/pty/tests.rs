//! The shell's launch and the foreground program.

use super::launch::{environment, exec_line, logical_pwd};
use super::running_program;
use std::ffi::CString;

#[test]
fn a_shell_started_through_a_link_keeps_the_links_path() {
    let root = std::env::temp_dir().join(format!("dashi-term-pwd-{}", std::process::id()));
    let real = root.join("developer");
    let link = root.join("Developer");
    std::fs::create_dir_all(&real).unwrap();
    let _ = std::fs::remove_file(&link);
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let link = link.to_str().unwrap().to_string();
    assert_eq!(logical_pwd(&link), Some(link.clone()));
    // The shell's environment carries it, in place of the terminal's own PWD.
    let env = environment(&[("PWD".into(), link.clone())]);
    let pwds: Vec<_> = env
        .iter()
        .filter_map(|entry| entry.to_str().ok()?.strip_prefix("PWD="))
        .collect();
    assert_eq!(pwds, [link.as_str()]);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_pwd_shells_would_not_trust_is_left_out() {
    assert_eq!(logical_pwd("Developer"), None);
    assert_eq!(logical_pwd("/tmp/../tmp"), None);
    assert_eq!(logical_pwd("/tmp/./x"), None);
    assert_eq!(logical_pwd("/tmp/."), None);
    assert_eq!(logical_pwd("/tmp//x"), None);
    assert_eq!(logical_pwd("/tmp/"), None);
    assert_eq!(logical_pwd("/no/such/folder/here"), None);
    assert_eq!(logical_pwd("/"), Some("/".into()));
}

#[test]
fn the_shell_at_its_prompt_is_not_running_anything() {
    let named = |_| Some("sleep\n".to_string());
    assert_eq!(running_program(100, 100, named), None);
    assert_eq!(running_program(-1, 100, named), None);
    assert_eq!(running_program(0, 100, named), None);
}

#[test]
fn another_group_in_front_is_a_running_program() {
    assert_eq!(
        running_program(120, 100, |pid| (pid == 120).then(|| "sleep\n".to_string())),
        Some("sleep".to_string())
    );
    assert_eq!(running_program(120, 100, |_| None), Some(String::new()));
}

#[test]
fn a_command_runs_in_place_of_the_shell_its_words_untouched() {
    let words = |argv: Vec<CString>| -> Vec<String> {
        argv.into_iter()
            .map(|arg| arg.into_string().unwrap())
            .collect()
    };
    let (program, argv) = exec_line(c"/bin/zsh", &["-i".into()], &[]);
    assert_eq!(program.to_str().unwrap(), "/bin/zsh");
    assert_eq!(words(argv), ["-zsh", "-i"]);
    let command = ["htop".to_string(), "--tree".into(), "a b; rm -rf ~".into()];
    let (program, argv) = exec_line(c"/bin/zsh", &["-i".into()], &command);
    assert_eq!(program.to_str().unwrap(), "/bin/sh");
    assert_eq!(
        words(argv),
        [
            "sh",
            "-c",
            "exec \"$@\"",
            "sh",
            "htop",
            "--tree",
            "a b; rm -rf ~"
        ]
    );
}
