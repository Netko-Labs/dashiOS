//! The wheel against a pipe standing in for the PTY.

use super::Vt;

/// What the terminal wrote to its PTY, through a pipe standing in for one.
fn written(feed: &[u8], scroll: f64) -> Vec<u8> {
    let mut ends = [0; 2];
    // SAFETY: a fresh pipe; both ends are closed below.
    assert_eq!(unsafe { libc::pipe(ends.as_mut_ptr()) }, 0);
    let mut vt = Vt::new(20, 5, ends[1]).expect("a terminal");
    vt.feed(feed);
    vt.scroll(scroll);
    drop(vt);
    // SAFETY: our own pipe's ends.
    unsafe { libc::close(ends[1]) };
    let mut out = vec![0u8; 256];
    // SAFETY: reading into our own buffer from our own pipe.
    let n = unsafe { libc::read(ends[0], out.as_mut_ptr().cast(), out.len()) };
    // SAFETY: as above.
    unsafe { libc::close(ends[0]) };
    out.truncate(n.max(0) as usize);
    out
}

#[test]
fn the_wheel_is_arrows_for_a_full_screen_program_without_the_mouse() {
    assert_eq!(written(b"\x1b[?1049h", 2.0), b"\x1b[A\x1b[A");
    assert_eq!(written(b"\x1b[?1049h", -1.0), b"\x1b[B");
    // In the shell's own screen the wheel scrolls the view and writes nothing.
    assert!(written(b"", 2.0).is_empty());
    // A program that asked for the mouse gets no arrows.
    assert!(written(b"\x1b[?1049h\x1b[?1000h", 2.0).is_empty());
}
