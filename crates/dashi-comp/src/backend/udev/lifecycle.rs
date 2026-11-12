//! The open/close state machine of a GPU that does not draw (sleep.rs
//! drives it; this file makes no calls). What holds it open (screens on its
//! connectors, client buffers only it can read, the shell's `gpu-keep`), the
//! grace before it is let go, and the probe that comes before every opening:
//! a thread opens the card's node first, so a card that fell off the bus (an
//! open of it hangs in the driver) stalls that thread, never the event loop.
//!
//! Times are passed in (`now`), so every rule is tested without waiting.

use std::time::{Duration, Instant};

mod answers;
#[cfg(test)]
mod tests;

pub(super) use answers::{Answer, Grace, Probe, Want};

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
