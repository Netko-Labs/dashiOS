use super::*;

#[test]
fn every_file_is_pinned_to_a_commit_and_a_hash() {
    let mut paths = std::collections::HashSet::new();
    for set in &SETS {
        assert!(!set.files.is_empty());
        for file in set.files {
            // "resolve/<40 hex>/": a commit, never a branch that can move.
            let commit = file
                .url
                .split("/resolve/")
                .nth(1)
                .and_then(|rest| rest.split('/').next());
            assert!(
                commit.is_some_and(|c| c.len() == 40 && c.chars().all(|x| x.is_ascii_hexdigit())),
                "{}",
                file.url
            );
            assert!(file.url.starts_with("https://huggingface.co/"));
            assert_eq!(file.sha256.len(), 64, "{}", file.path);
            assert!(
                file.sha256
                    .chars()
                    .all(|x| x.is_ascii_hexdigit() && !x.is_ascii_uppercase())
            );
            assert!(file.bytes > 0);
            // A path stays inside its set's folder, and is used once.
            assert!(!file.path.starts_with('/') && !file.path.contains(".."));
            assert!(paths.insert((set.id, file.path)), "{} twice", file.path);
        }
    }
}

#[test]
fn the_sizes_are_what_settings_will_say() {
    assert_eq!(set(LISTEN_SET).map(Set::bytes), Some(672_862_728));
    assert_eq!(set(SPEAK_SET).map(Set::bytes), Some(334_932_491));
    assert_eq!(set(WHISPER_SET).map(Set::bytes), Some(1_036_613_791));
    assert_eq!(set(REWRITE_SET).map(Set::bytes), Some(541_903_616));
    assert!(set("other").is_none());
}
