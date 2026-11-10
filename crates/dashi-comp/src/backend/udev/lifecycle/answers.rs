//! What the lifecycle asks of its driver (sleep.rs, probe.rs): after wanting a
//! GPU open, after a probe's answer, and after a grace timer.

use std::time::Instant;

/// What wanting a GPU open asks of the driver.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::backend::udev) enum Want {
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
pub(in crate::backend::udev) enum Probe {
    /// The node opened (and closed again): open it through the seat.
    Opened,
    /// The kernel said no at once: cardwire blocks it, or it is gone.
    Refused,
}

/// What a probe's answer asks of the driver.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::backend::udev) enum Answer {
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
pub(in crate::backend::udev) enum Grace {
    /// Let it go now.
    Sleep,
    /// Only buffers hold it: the timer fires again at this instant.
    Again(Instant),
    /// Held, or not this timer's grace: drop the timer.
    Done,
}
