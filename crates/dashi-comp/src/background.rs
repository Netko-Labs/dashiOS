//! Work that blocks (encoding, file IO) runs on a thread of its own and comes
//! back to the event loop as an event (docs/conventions.md, "Rust"): the loop
//! routes input and queues frames meanwhile.

use smithay::reexports::calloop::{LoopHandle, channel};

/// Run `work` on a thread named `name`; `then` gets its result on the event
/// loop. Err when no thread or event source could be made (nothing ran).
pub(crate) fn run<D: 'static, T: Send + 'static>(
    handle: &LoopHandle<'static, D>,
    name: &str,
    work: impl FnOnce() -> T + Send + 'static,
    then: impl FnOnce(&mut D, T) + 'static,
) -> Result<(), String> {
    let (sender, receiver) = channel::channel::<T>();
    let mut then = Some(then);
    let token = handle
        .insert_source(receiver, move |event, _, data| {
            if let (channel::Event::Msg(result), Some(then)) = (event, then.take()) {
                then(data, result);
            }
        })
        .map_err(|error| format!("{name}: {error}"))?;
    let spawned = std::thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            let _ = sender.send(work());
        });
    spawned.map(drop).map_err(|error| {
        handle.remove(token);
        format!("{name}: no thread: {error}")
    })
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use smithay::reexports::calloop::EventLoop;

    use super::*;

    #[test]
    fn slow_work_does_not_hold_the_loop() {
        let mut event_loop: EventLoop<'static, Vec<u32>> = EventLoop::try_new().unwrap();
        let mut seen = Vec::new();
        run(
            &event_loop.handle(),
            "test-slow",
            || {
                std::thread::sleep(Duration::from_millis(300));
                7
            },
            |seen: &mut Vec<u32>, n| seen.push(n),
        )
        .unwrap();
        // The loop turns at once, with nothing back yet.
        let start = Instant::now();
        event_loop
            .dispatch(Some(Duration::ZERO), &mut seen)
            .unwrap();
        assert!(start.elapsed() < Duration::from_millis(100));
        assert!(seen.is_empty());
        // Then the result comes back as an event.
        while seen.is_empty() && start.elapsed() < Duration::from_secs(5) {
            event_loop
                .dispatch(Some(Duration::from_millis(50)), &mut seen)
                .unwrap();
        }
        assert_eq!(seen, vec![7]);
    }
}
