use super::*;

const fn ms(ms: u64) -> Duration {
    Duration::from_millis(ms)
}

const OVERLAY_AND_CURSOR: Used = Used {
    primary: false,
    overlays: 1,
    cursor: true,
};
const CURSOR: Used = Used {
    primary: false,
    overlays: 0,
    cursor: true,
};
const NOTHING: Used = Used {
    primary: false,
    overlays: 0,
    cursor: false,
};

#[test]
fn only_einval_is_a_refusal() {
    assert!(invalid(&std::io::Error::from_raw_os_error(22)), "EINVAL");
    assert!(!invalid(&std::io::Error::from_raw_os_error(16)), "EBUSY");
    assert!(!invalid(&std::io::Error::from_raw_os_error(13)), "EACCES");
}

#[test]
fn a_frame_that_keeps_being_refused_ends_up_drawn_without_planes() {
    let mut planes = Planes::default();
    assert_eq!(planes.flags(ms(0), || 1), FrameFlags::DEFAULT);
    // A client buffer on an overlay is refused: the next frame keeps only the cursor plane.
    assert_eq!(
        planes.refused(ms(0), OVERLAY_AND_CURSOR, 1),
        Refusal::First {
            next: Level::Cursor
        }
    );
    assert_eq!(
        planes.flags(ms(8), || 1),
        FrameFlags::ALLOW_CURSOR_PLANE_SCANOUT
    );
    // Refused again: the cursor is drawn into the picture too.
    assert_eq!(
        planes.refused(ms(8), CURSOR, 1),
        Refusal::Again { next: Level::None }
    );
    assert_eq!(planes.flags(ms(16), || 1), FrameFlags::empty());
    // That frame is taken: the run goes on, without planes, quietly.
    assert_eq!(planes.taken(ms(16)), None);
    assert_eq!(planes.flags(ms(24), || 1), FrameFlags::empty());
}

#[test]
fn a_refused_cursor_plane_alone_goes_straight_to_no_planes() {
    let mut planes = Planes::default();
    assert_eq!(
        planes.refused(ms(0), CURSOR, 1),
        Refusal::First { next: Level::None }
    );
    assert_eq!(planes.flags(ms(8), || 1), FrameFlags::empty());
}

#[test]
fn a_refusal_with_no_planes_is_said_once() {
    let mut planes = Planes::default();
    planes.refused(ms(0), OVERLAY_AND_CURSOR, 1);
    planes.refused(ms(8), CURSOR, 1);
    assert_eq!(planes.refused(ms(16), NOTHING, 1), Refusal::Bare);
    assert_eq!(
        planes.refused(ms(24), NOTHING, 1),
        Refusal::Again { next: Level::None }
    );
}

#[test]
fn planes_come_back_after_a_while() {
    let mut planes = Planes::default();
    planes.refused(ms(0), OVERLAY_AND_CURSOR, 1);
    planes.taken(ms(8));
    assert_eq!(
        planes.flags(ms(4_999), || 1),
        FrameFlags::ALLOW_CURSOR_PLANE_SCANOUT
    );
    assert_eq!(planes.flags(ms(5_000), || 1), FrameFlags::DEFAULT);
    assert_eq!(
        planes.taken(ms(5_000)),
        Some(Recovered {
            refused: 1,
            lasted: ms(5_000),
            shown: Some(Level::Cursor),
        })
    );
    // Over: the next refusal starts a new run, with a warning.
    assert_eq!(
        planes.refused(ms(6_000), OVERLAY_AND_CURSOR, 1),
        Refusal::First {
            next: Level::Cursor
        }
    );
}

#[test]
fn a_retry_that_is_refused_waits_twice_as_long() {
    let mut planes = Planes::default();
    planes.refused(ms(0), OVERLAY_AND_CURSOR, 1);
    assert_eq!(planes.flags(ms(5_000), || 1), FrameFlags::DEFAULT);
    assert_eq!(
        planes.refused(ms(5_000), OVERLAY_AND_CURSOR, 1),
        Refusal::Again {
            next: Level::Cursor
        }
    );
    assert_eq!(
        planes.flags(ms(14_999), || 1),
        FrameFlags::ALLOW_CURSOR_PLANE_SCANOUT
    );
    assert_eq!(planes.flags(ms(15_000), || 1), FrameFlags::DEFAULT);
}

#[test]
fn the_wait_stops_growing_at_a_minute() {
    let mut planes = Planes::default();
    let mut now = ms(0);
    planes.refused(now, OVERLAY_AND_CURSOR, 1);
    for _ in 0..10 {
        while planes.flags(now, || 1) != FrameFlags::DEFAULT {
            now += ms(1_000);
        }
        planes.refused(now, OVERLAY_AND_CURSOR, 1);
    }
    assert_eq!(
        planes.flags(now + LONGEST_WAIT - ms(1), || 1),
        FrameFlags::ALLOW_CURSOR_PLANE_SCANOUT
    );
    assert_eq!(planes.flags(now + LONGEST_WAIT, || 1), FrameFlags::DEFAULT);
}

#[test]
fn new_windows_bring_planes_back_sooner_but_not_at_once() {
    let mut planes = Planes::default();
    planes.refused(ms(0), OVERLAY_AND_CURSOR, 1);
    // The windows changed, but a second has not passed.
    assert_eq!(
        planes.flags(ms(500), || 2),
        FrameFlags::ALLOW_CURSOR_PLANE_SCANOUT
    );
    // The same windows a second on: still waiting.
    assert_eq!(
        planes.flags(ms(1_000), || 1),
        FrameFlags::ALLOW_CURSOR_PLANE_SCANOUT
    );
    assert_eq!(planes.flags(ms(1_000), || 2), FrameFlags::DEFAULT);
}

#[test]
fn a_reset_screen_tries_every_plane() {
    let mut planes = Planes::default();
    planes.refused(ms(0), OVERLAY_AND_CURSOR, 1);
    planes.clear();
    assert_eq!(planes.flags(ms(10), || 1), FrameFlags::DEFAULT);
    assert!(planes.taken(ms(10)).is_some());
}
