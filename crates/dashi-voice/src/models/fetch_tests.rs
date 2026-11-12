//! Fetches from `file://` addresses: curl reads a local file as it would a
//! server, so nothing here needs a network.

use super::*;

const WORDS: &str = "the quick brown fox jumps over the lazy dog";
const WORDS_SHA: &str = "05c6e08f1d9fdafa03147fcb8f82f124c76d2f70e3d989dc8aadb5e7d7450bec";

struct Fixture {
    _folder: tempfile::TempDir,
    store: Store,
    set: &'static Set,
}

/// A set of one file, served from a temporary folder.
fn fixture(sha256: &'static str) -> Fixture {
    let folder = tempfile::tempdir().unwrap();
    let source = folder.path().join("source.bin");
    std::fs::write(&source, WORDS).unwrap();
    let url: &'static str = Box::leak(format!("file://{}", source.display()).into_boxed_str());
    let files: &'static [File] = Box::leak(Box::new([File {
        path: "deep/words.bin",
        url,
        bytes: WORDS.len() as u64,
        sha256,
    }]));
    let set: &'static Set = Box::leak(Box::new(Set {
        id: "test",
        name: "Test",
        about: "",
        credit: "",
        basic: true,
        files,
    }));
    let store = Store::new(folder.path().join("models"));
    Fixture {
        _folder: folder,
        store,
        set,
    }
}

fn has_curl() -> bool {
    Command::new("curl")
        .arg("--version")
        .stdout(Stdio::null())
        .status()
        .is_ok()
}

#[test]
fn a_file_is_fetched_checked_and_named() {
    if !has_curl() {
        return;
    }
    let fixture = fixture(WORDS_SHA);
    let mut seen = Vec::new();
    let finished = fetch(&fixture.store, &[fixture.set], &mut |progress| {
        seen.push(progress);
        true
    })
    .unwrap();
    assert!(finished);
    assert!(fixture.store.installed(fixture.set));
    let path = fixture.store.path(fixture.set, &fixture.set.files[0]);
    assert_eq!(std::fs::read_to_string(path).unwrap(), WORDS);
    assert!(
        !fixture
            .store
            .partial(fixture.set, &fixture.set.files[0])
            .exists()
    );
    assert_eq!(seen[0].bytes, WORDS.len() as u64);
    assert_eq!((seen[0].set, seen[0].file), ("test", "deep/words.bin"));
    // Asked again, there is nothing to fetch and nothing to report.
    let mut again = 0;
    assert!(
        fetch(&fixture.store, &[fixture.set], &mut |_| {
            again += 1;
            true
        })
        .unwrap()
    );
    assert_eq!(again, 0);
}

#[test]
fn a_stopped_fetch_is_resumed_from_its_part() {
    if !has_curl() {
        return;
    }
    let fixture = fixture(WORDS_SHA);
    let part = fixture.store.partial(fixture.set, &fixture.set.files[0]);
    std::fs::create_dir_all(part.parent().unwrap()).unwrap();
    std::fs::write(&part, &WORDS[..10]).unwrap();
    let mut first = None;
    assert!(
        fetch(&fixture.store, &[fixture.set], &mut |progress| {
            first.get_or_insert(progress.received);
            true
        })
        .unwrap()
    );
    // It began from the ten bytes that were there.
    assert_eq!(first, Some(10));
    assert!(fixture.store.installed(fixture.set));
}

#[test]
fn a_stale_part_is_fetched_again_from_nothing() {
    if !has_curl() {
        return;
    }
    let fixture = fixture(WORDS_SHA);
    let part = fixture.store.partial(fixture.set, &fixture.set.files[0]);
    std::fs::create_dir_all(part.parent().unwrap()).unwrap();
    std::fs::write(&part, "THE QUICK ").unwrap();
    assert!(fetch(&fixture.store, &[fixture.set], &mut |_| true).unwrap());
    let path = fixture.store.path(fixture.set, &fixture.set.files[0]);
    assert_eq!(std::fs::read_to_string(path).unwrap(), WORDS);
}

#[test]
fn a_file_with_the_wrong_hash_is_never_kept() {
    if !has_curl() {
        return;
    }
    let fixture = fixture("0000000000000000000000000000000000000000000000000000000000000000");
    let error = fetch(&fixture.store, &[fixture.set], &mut |_| true).unwrap_err();
    assert!(error.contains("did not arrive whole"), "{error}");
    assert!(!fixture.store.installed(fixture.set));
    assert!(
        !fixture
            .store
            .partial(fixture.set, &fixture.set.files[0])
            .exists()
    );
}

#[test]
fn a_cancelled_fetch_stops_and_says_so() {
    if !has_curl() {
        return;
    }
    let fixture = fixture(WORDS_SHA);
    assert!(!fetch(&fixture.store, &[fixture.set], &mut |_| false).unwrap());
    assert!(!fixture.store.installed(fixture.set));
}

#[test]
fn sizes_and_failures_are_said_in_words() {
    assert_eq!(megabytes(672_862_728), "673 MB");
    assert_eq!(megabytes(1), "1 MB");
    assert!(curl_words(Some(6), "a.onnx").contains("offline"));
    assert!(curl_words(Some(23), "a.onnx").contains("disk is full"));
    assert!(free_bytes(Path::new("/")).is_some_and(|free| free > 0));
}
