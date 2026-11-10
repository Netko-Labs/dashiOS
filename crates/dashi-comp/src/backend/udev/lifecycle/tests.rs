//! The lifecycle's rules, each tested with times passed in.

use super::*;

fn holds(screens: usize, buffers: usize, kept: bool) -> Holds {
    Holds {
        screens,
        buffers,
        kept,
    }
}

fn secs(n: u64) -> Duration {
    Duration::from_secs(n)
}

/// A card opened through a probe at `t0`.
fn opened(t0: Instant) -> Life {
    let mut life = Life::asleep(None);
    let Want::Probe { id, .. } = life.want(t0) else {
        panic!("an asleep card is probed")
    };
    assert_eq!(life.answered(id, Probe::Opened, t0), Answer::Open);
    life
}

#[test]
fn a_screen_or_the_shell_holds_a_gpu_and_buffers_hold_it_while_they_live() {
    assert_eq!(holds(1, 0, false).next(), Next::Stay);
    assert_eq!(holds(0, 0, true).next(), Next::Stay);
    assert_eq!(holds(0, 2, false).next(), Next::Wait);
    assert_eq!(holds(0, 0, false).next(), Next::Sleep);
}

#[test]
fn a_card_is_probed_once_however_many_want_it() {
    let t0 = Instant::now();
    let mut life = Life::asleep(None);
    let Want::Probe { id, deadline } = life.want(t0) else {
        panic!("an asleep card is probed")
    };
    assert_eq!(deadline, t0 + PROBE_DEADLINE);
    assert_eq!(life.want(t0 + secs(1)), Want::Pending);
    assert!(life.is_probing());
    assert_eq!(life.answered(id, Probe::Opened, t0 + secs(1)), Answer::Open);
    assert!(life.is_open());
    assert_eq!(life.want(t0 + secs(2)), Want::Open);
}

#[test]
fn a_refused_probe_leaves_it_asleep_as_it_was() {
    let slept = Instant::now();
    let t0 = slept + secs(5);
    let mut life = Life::asleep(Some(slept));
    let Want::Probe { id, .. } = life.want(t0) else {
        panic!("an asleep card is probed")
    };
    assert_eq!(life.answered(id, Probe::Refused, t0), Answer::Refused);
    assert_eq!(life.phase(), Phase::Asleep { since: Some(slept) });
}

#[test]
fn a_probe_past_its_deadline_leaves_the_card_alone_until_it_returns() {
    let t0 = Instant::now();
    let mut life = Life::asleep(None);
    let Want::Probe { id, deadline } = life.want(t0) else {
        panic!("an asleep card is probed")
    };
    assert!(life.deadline(id, deadline));
    assert!(!life.answers());
    // Nothing opens it, nothing looks at it, a second deadline is no news.
    assert_eq!(life.want(deadline + secs(60)), Want::Stuck);
    assert!(!life.look_on_change(true, deadline + secs(60)));
    assert!(!life.deadline(id, deadline + secs(1)));
    // The thread comes back, hours later: asleep, quiet as after a sleep.
    let back = deadline + secs(3600);
    assert_eq!(life.answered(id, Probe::Opened, back), Answer::Recovered);
    assert_eq!(life.phase(), Phase::Asleep { since: Some(back) });
    assert!(life.answers());
}

#[test]
fn old_probes_and_deadlines_are_ignored() {
    let t0 = Instant::now();
    let mut life = Life::asleep(None);
    let Want::Probe { id: first, .. } = life.want(t0) else {
        panic!("an asleep card is probed")
    };
    assert_eq!(life.answered(first, Probe::Refused, t0), Answer::Refused);
    let Want::Probe { id: second, .. } = life.want(t0 + secs(2)) else {
        panic!("probed again")
    };
    assert_ne!(first, second);
    // The first probe's deadline timer fires late: the second probe is not stuck.
    assert!(!life.deadline(first, t0 + PROBE_DEADLINE));
    assert_eq!(
        life.answered(first, Probe::Opened, t0 + secs(3)),
        Answer::Stale
    );
    assert!(life.is_probing());
    assert_eq!(
        life.answered(second, Probe::Opened, t0 + secs(3)),
        Answer::Open
    );
    // Open: a deadline for the probe that opened it changes nothing.
    assert!(!life.deadline(second, t0 + secs(5)));
    assert!(life.is_open());
}

#[test]
fn nothing_holding_it_lets_it_go_after_the_grace() {
    let t0 = Instant::now();
    let mut life = opened(t0);
    let at = life.settle(holds(0, 0, false), t0).expect("a grace starts");
    assert_eq!(at, t0 + GRACE);
    // A second settle while the grace runs starts no second timer.
    assert_eq!(life.settle(holds(0, 0, false), t0 + secs(1)), None);
    assert_eq!(life.grace_due(holds(0, 0, false), at, at), Grace::Sleep);
    assert_eq!(life.phase(), Phase::Asleep { since: Some(at) });
}

#[test]
fn a_screen_back_within_the_grace_keeps_it_open() {
    let t0 = Instant::now();
    let mut life = opened(t0);
    assert_eq!(life.settle(holds(1, 0, false), t0), None);
    let at = life.settle(holds(0, 0, false), t0).expect("a grace starts");
    // The cable is pushed back in.
    assert_eq!(life.grace_due(holds(1, 0, false), at, at), Grace::Done);
    assert_eq!(life.phase(), Phase::Open { grace: None });
    // Pulled again: a new grace.
    assert!(life.settle(holds(0, 0, false), at + secs(1)).is_some());
}

#[test]
fn buffers_hold_it_grace_after_grace() {
    let t0 = Instant::now();
    let mut life = opened(t0);
    let at = life.settle(holds(0, 1, false), t0).expect("a grace starts");
    let again = at + GRACE;
    assert_eq!(
        life.grace_due(holds(0, 1, false), at, at),
        Grace::Again(again)
    );
    assert_eq!(
        life.grace_due(holds(0, 0, false), again, again),
        Grace::Sleep
    );
}

#[test]
fn a_timer_from_an_earlier_opening_does_not_end_the_next() {
    let t0 = Instant::now();
    let mut life = opened(t0);
    let old = life.settle(holds(0, 0, false), t0).expect("a grace starts");
    assert_eq!(life.grace_due(holds(0, 0, false), old, old), Grace::Sleep);
    // Opened again at once, and its own grace starts later.
    let t1 = old + secs(1);
    let Want::Probe { id, .. } = life.want(t1) else {
        panic!("an asleep card is probed")
    };
    assert_eq!(life.answered(id, Probe::Opened, t1), Answer::Open);
    let new = life.settle(holds(0, 0, false), t1).expect("a grace starts");
    assert_eq!(life.grace_due(holds(0, 0, false), old, t1), Grace::Done);
    assert!(life.is_open());
    // A timer that fires early is set again for its instant.
    assert_eq!(
        life.grace_due(holds(0, 0, false), new, t1),
        Grace::Again(new)
    );
    assert_eq!(life.grace_due(holds(0, 0, false), new, new), Grace::Sleep);
}

#[test]
fn a_card_that_failed_to_open_sleeps() {
    let t0 = Instant::now();
    let mut life = opened(t0);
    life.open_failed(t0);
    assert_eq!(life.phase(), Phase::Asleep { since: Some(t0) });
}

#[test]
fn a_change_wakes_a_gpu_with_a_screen_and_looks_only_after_it_slept_a_while() {
    let t0 = Instant::now();
    let never = Life::asleep(None);
    assert!(never.look_on_change(false, t0));
    let slept = Life::asleep(Some(t0));
    assert!(slept.look_on_change(true, t0 + secs(1)));
    assert!(!slept.look_on_change(false, t0 + secs(1)));
    assert!(slept.look_on_change(false, t0 + QUIET_AFTER_SLEEP));
    // Open or probing: a change is the scanner's, not a reason to probe.
    assert!(!opened(t0).look_on_change(true, t0));
}

#[test]
fn a_screen_that_would_not_open_is_tried_again_less_and_less_often() {
    let mut life = Life::asleep(None);
    let waits: Vec<Duration> = (0..8).map(|_| life.next_retry()).collect();
    assert_eq!(waits[0], RETRY_FIRST);
    assert_eq!(waits[1], RETRY_FIRST * 2);
    assert!(waits.windows(2).all(|pair| pair[0] <= pair[1]));
    assert_eq!(*waits.last().expect("eight waits"), RETRY_MAX);
    life.reset_retry();
    assert_eq!(life.next_retry(), RETRY_FIRST);
}

#[test]
fn a_failed_wake_for_a_buffer_is_not_tried_again_at_once() {
    assert!(may_wake_for_buffer(None));
    assert!(!may_wake_for_buffer(Some(secs(2))));
    assert!(may_wake_for_buffer(Some(BUFFER_RETRY)));
}
