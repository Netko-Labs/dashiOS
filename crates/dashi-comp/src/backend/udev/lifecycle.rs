//! The open/close state machine of a GPU that does not draw (sleep.rs
//! drives it; this file makes no calls). What holds it open (screens on its
//! connectors, client buffers only it can read, the shell's `gpu-keep`), the
//! grace before it is let go, and the probe that comes before every opening:
//! a thread opens the card's node first, so a card that fell off the bus (an
//! open of it hangs in the driver) stalls that thread, never the event loop.
//!
//! Times are passed in (`now`), so every rule is tested without waiting.

use std::time::{Duration, Instant};

/// How long a GPU nothing needs stays open: a cable pulled and pushed back, a monitor's power cycle.
pub(super) const GRACE: Duration = Duration::from_secs(10);
/// How long a probe may take before the card counts as stuck (an open takes
/// well under a second, its runtime resume included).
pub(super) const PROBE_DEADLINE: Duration = Duration::from_secs(3);
/// A change event on a GPU asleep, with sysfs saying nothing is connected,
/// opens it to look, unless it went to sleep this recently (its own suspend
/// or resume may raise one, and looking would wake it for nothing).
const QUIET_AFTER_SLEEP: Duration = Duration::from_secs(30);
/// After a client buffer no GPU could read, even with the sleeping ones woken: how long before waking them for one again.
const BUFFER_RETRY: Duration = Duration::from_secs(30);
/// A screen is connected but the card would not open (cardwire blocks it in
/// Integrated mode until the shell switches to Hybrid): try again after this,
/// doubling up to `RETRY_MAX`.
const RETRY_FIRST: Duration = Duration::from_secs(2);
const RETRY_MAX: Duration = Duration::from_secs(60);

/// What holds a GPU that does not draw open.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct Holds {
    /// Screens connected to it.
    pub(super) screens: usize,
    /// Client buffers only it could read, still alive.
    pub(super) buffers: usize,
    /// The shell keeps it warm (`gpu-keep`).
    pub(super) kept: bool,
}

/// What to do with a GPU nothing may need, at the end of its grace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Next {
    /// A screen or the shell holds it: nothing to wait for.
    Stay,
    /// Only client buffers hold it: look again after another grace.
    Wait,
    /// Nothing holds it: let it go.
    Sleep,
}

impl Holds {
    pub(super) fn next(self) -> Next {
        if self.screens > 0 || self.kept {
            Next::Stay
        } else if self.buffers > 0 {
            Next::Wait
        } else {
            Next::Sleep
        }
    }
}

/// Where a GPU that does not draw is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Phase {
    /// Closed: only a path. `since`: when it was let go (None: never opened).
    Asleep { since: Option<Instant> },
    /// Probe `id` is out (a thread opening its node), `deadline` to answer.
    Probing {
        id: u64,
        deadline: Instant,
        since: Option<Instant>,
    },
    /// Open; `grace`: when it is let go if nothing holds it then.
    Open { grace: Option<Instant> },
    /// Probe `id` missed its deadline: a call on the card may hang in the
    /// kernel, so nothing touches it until that probe returns (or udev
    /// removes the card).
    Stuck { id: u64, since: Instant },
}

/// What wanting a GPU open asks of the driver.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Want {
    /// Start probe `id`; its deadline is at `deadline`.
    Probe { id: u64, deadline: Instant },
    /// A probe is already out: its answer opens it.
    Pending,
    /// It is open already.
    Open,
    /// It does not answer: left alone.
    Stuck,
}

/// What a probe found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Probe {
    /// The node opened (and closed again): open it through the seat.
    Opened,
    /// The kernel said no at once: cardwire blocks it, or it is gone.
    Refused,
}

/// What a probe's answer asks of the driver.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Answer {
    /// Open it through the seat now (`opened` or `open_failed` after).
    Open,
    /// It would not open: it stays asleep.
    Refused,
    /// The stuck probe came back: the card answers again; it is asleep, so
    /// look at it again as after a change.
    Recovered,
    /// Not the probe this card waits for (or the card was removed): ignore it.
    Stale,
}

/// What a grace timer that fires asks of the driver.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Grace {
    /// Let it go now.
    Sleep,
    /// Only buffers hold it: the timer fires again at this instant.
    Again(Instant),
    /// Held, or not this timer's grace: drop the timer.
    Done,
}

/// One GPU that does not draw.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Life {
    phase: Phase,
    /// Counts probes, so an answer or a deadline for an old one is ignored.
    probes: u64,
    /// The wait before trying again a card with a screen that would not open.
    retry: Option<Duration>,
}

impl Life {
    /// Found by udev, or let go: closed.
    pub(super) fn asleep(since: Option<Instant>) -> Self {
        Self {
            phase: Phase::Asleep { since },
            probes: 0,
            retry: None,
        }
    }

    pub(super) fn phase(&self) -> Phase {
        self.phase
    }

    pub(super) fn is_open(&self) -> bool {
        matches!(self.phase, Phase::Open { .. })
    }

    pub(super) fn is_probing(&self) -> bool {
        matches!(self.phase, Phase::Probing { .. })
    }

    /// Whether its last probe answered (false while one is past its deadline).
    pub(super) fn answers(&self) -> bool {
        !matches!(self.phase, Phase::Stuck { .. })
    }

    /// Something needs it open (a screen, a buffer, the shell).
    pub(super) fn want(&mut self, now: Instant) -> Want {
        match self.phase {
            Phase::Asleep { since } => {
                self.probes += 1;
                let deadline = now + PROBE_DEADLINE;
                self.phase = Phase::Probing {
                    id: self.probes,
                    deadline,
                    since,
                };
                Want::Probe {
                    id: self.probes,
                    deadline,
                }
            }
            Phase::Probing { .. } => Want::Pending,
            Phase::Open { .. } => Want::Open,
            Phase::Stuck { .. } => Want::Stuck,
        }
    }

    /// Probe `id` came back with `probe`.
    pub(super) fn answered(&mut self, id: u64, probe: Probe, now: Instant) -> Answer {
        match self.phase {
            Phase::Probing { id: out, since, .. } if out == id => match probe {
                Probe::Opened => {
                    self.phase = Phase::Open { grace: None };
                    Answer::Open
                }
                Probe::Refused => {
                    self.phase = Phase::Asleep { since };
                    Answer::Refused
                }
            },
            Phase::Stuck { id: out, .. } if out == id => {
                // It just woke (or was refused): quiet as after a sleep.
                self.phase = Phase::Asleep { since: Some(now) };
                Answer::Recovered
            }
            _ => Answer::Stale,
        }
    }

    /// Probe `id`'s deadline passed: whether the card is now stuck.
    pub(super) fn deadline(&mut self, id: u64, now: Instant) -> bool {
        match self.phase {
            Phase::Probing { id: out, .. } if out == id => {
                self.phase = Phase::Stuck { id, since: now };
                true
            }
            _ => false,
        }
    }

    /// The seat would not open it after its probe did.
    pub(super) fn open_failed(&mut self, now: Instant) {
        if self.is_open() {
            self.phase = Phase::Asleep { since: Some(now) };
        }
    }

    /// Opened: the next refusal starts its retries from the shortest wait again.
    pub(super) fn reset_retry(&mut self) {
        self.retry = None;
    }

    /// A screen is connected but it would not open: the wait before trying again.
    pub(super) fn next_retry(&mut self) -> Duration {
        let wait = self
            .retry
            .map_or(RETRY_FIRST, |last| (last * 2).min(RETRY_MAX));
        self.retry = Some(wait);
        wait
    }

    /// Something holding it may have let go: when its grace ends, if a new
    /// grace starts now (None: held, or a grace is already running).
    pub(super) fn settle(&mut self, holds: Holds, now: Instant) -> Option<Instant> {
        match self.phase {
            Phase::Open { grace: None } if holds.next() != Next::Stay => {
                let at = now + GRACE;
                self.phase = Phase::Open { grace: Some(at) };
                Some(at)
            }
            _ => None,
        }
    }

    /// The grace timer set for `at` fired.
    pub(super) fn grace_due(&mut self, holds: Holds, at: Instant, now: Instant) -> Grace {
        let Phase::Open { grace: Some(due) } = self.phase else {
            return Grace::Done;
        };
        if due != at {
            // A timer from an earlier grace: the current one has its own.
            return Grace::Done;
        }
        if now < due {
            return Grace::Again(due);
        }
        match holds.next() {
            Next::Stay => {
                self.phase = Phase::Open { grace: None };
                Grace::Done
            }
            Next::Wait => {
                let again = now + GRACE;
                self.phase = Phase::Open { grace: Some(again) };
                Grace::Again(again)
            }
            Next::Sleep => {
                self.phase = Phase::Asleep { since: Some(now) };
                Grace::Sleep
            }
        }
    }

    /// udev says its connectors changed: whether to open it to look. Only an
    /// asleep card: sysfs says a screen is there, or it has slept long enough
    /// that looking is cheap (sysfs may not have heard yet).
    pub(super) fn look_on_change(&self, connected: bool, now: Instant) -> bool {
        match self.phase {
            Phase::Asleep { since } => {
                connected
                    || since.is_none_or(|since| {
                        now.saturating_duration_since(since) >= QUIET_AFTER_SLEEP
                    })
            }
            _ => false,
        }
    }
}

/// Whether to wake sleeping GPUs for a buffer the open ones cannot read.
pub(super) fn may_wake_for_buffer(since_failed: Option<Duration>) -> bool {
    since_failed.is_none_or(|since| since >= BUFFER_RETRY)
}

#[cfg(test)]
mod tests {
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
}
