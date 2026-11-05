//! The MP1 mailbox: its three SMN register addresses per CPU family, and the
//! request sequence RyzenAdj uses (clear the response, write the arguments,
//! send the message id, wait for the response to change, read it back).

use std::io;
use std::thread::sleep;
use std::time::{Duration, Instant};

use super::encode::{MSG_SET_ALL_CORE, MSG_SET_PER_CORE, all_core_arg, per_core_arg};
use super::smn::Smn;

/// The MP1 mailbox's three registers (SMN addresses).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Mp1 {
    pub(crate) message: u32,
    pub(crate) response: u32,
    pub(crate) arg_base: u32,
}

/// Strix Point (Zen 5, the Ryzen AI 9 HX 370) and its relatives
/// (Krackan Point, Strix Halo). `FAM_STRIXPOINT` in RyzenAdj.
pub(crate) fn strix_point() -> Mp1 {
    Mp1 {
        message: 0x3B1_0928,
        response: 0x3B1_0978,
        arg_base: 0x3B1_0998,
    }
}

/// The mailbox for a CPU family, or `None` when Dashi doesn't know it (the
/// Curve Optimizer is then `unsupported-cpu`).
pub(crate) fn for_family(family: Family) -> Option<Mp1> {
    match family {
        Family::StrixPoint => Some(strix_point()),
    }
}

/// The CPU families Dashi's SMU path knows. Only Strix Point is verified on
/// this hardware; others are added as they are tested, per docs/hardware.md.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Family {
    StrixPoint,
}

impl Family {
    /// Identify the family from CPUID (`family`, `model`), as RyzenAdj does.
    pub(crate) fn from_cpuid(family: u32, model: u32) -> Option<Family> {
        match (family, model) {
            // Zen 5 mobile: models 0x20 and 0x24 are Strix Point.
            (0x1A, 0x20 | 0x24) => Some(Family::StrixPoint),
            _ => None,
        }
    }
}

const REP_MSG_OK: u32 = 0x1;
const REP_MSG_UNKNOWN_CMD: u32 = 0xFE;
/// How long to wait for the SMU to answer before giving up.
const RESPONSE_TIMEOUT: Duration = Duration::from_millis(500);

/// The outcome of one mailbox request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Response {
    Ok,
    UnknownCommand,
    Rejected(u32),
    TimedOut,
}

fn arg_addr(mp1: &Mp1, index: u32) -> u32 {
    mp1.arg_base + 4 * index
}

/// One request: clear the response, pass arg0 (the rest 0), send the id, wait.
pub(crate) fn request(smn: &mut dyn Smn, mp1: &Mp1, id: u32, arg0: u32) -> io::Result<Response> {
    smn.write(mp1.response, 0)?;
    for index in 0..6 {
        smn.write(arg_addr(mp1, index), if index == 0 { arg0 } else { 0 })?;
    }
    smn.write(mp1.message, id)?;
    let deadline = Instant::now() + RESPONSE_TIMEOUT;
    loop {
        let response = smn.read(mp1.response)?;
        if response != 0 {
            return Ok(match response {
                REP_MSG_OK => Response::Ok,
                REP_MSG_UNKNOWN_CMD => Response::UnknownCommand,
                other => Response::Rejected(other),
            });
        }
        if Instant::now() >= deadline {
            return Ok(Response::TimedOut);
        }
        sleep(Duration::from_micros(100));
    }
}

/// Whether the PCI bus takes writes at all: write a token to arg0 and read it
/// back. Under kernel lockdown (Secure Boot) the write is dropped and this is
/// `false`, so the Curve Optimizer reports `lockdown`.
pub(crate) fn writable(smn: &mut dyn Smn, mp1: &Mp1) -> io::Result<bool> {
    const TOKEN: u32 = 0x47;
    smn.write(arg_addr(mp1, 0), TOKEN)?;
    Ok(smn.read(arg_addr(mp1, 0))? == TOKEN)
}

/// Send an all-core offset. `Ok(())` only on `REP_MSG_OK`.
pub(crate) fn set_all_core(smn: &mut dyn Smn, mp1: &Mp1, offset: i32) -> Result<(), String> {
    let arg = all_core_arg(offset)?;
    finish(request(smn, mp1, MSG_SET_ALL_CORE, arg))
}

/// Send one core's offset.
pub(crate) fn set_per_core(
    smn: &mut dyn Smn,
    mp1: &Mp1,
    core: u32,
    offset: i32,
) -> Result<(), String> {
    let arg = per_core_arg(core, offset)?;
    finish(request(smn, mp1, MSG_SET_PER_CORE, arg))
}

fn finish(result: io::Result<Response>) -> Result<(), String> {
    match result.map_err(|e| e.to_string())? {
        Response::Ok => Ok(()),
        Response::UnknownCommand => Err("the SMU doesn't know this command".into()),
        Response::Rejected(code) => Err(format!("the SMU rejected it (0x{code:02X})")),
        Response::TimedOut => Err("the SMU didn't answer".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::smu::smn::SimSmu;

    #[test]
    fn strix_point_is_recognised_from_cpuid() {
        assert_eq!(Family::from_cpuid(0x1A, 0x24), Some(Family::StrixPoint));
        assert_eq!(Family::from_cpuid(0x1A, 0x20), Some(Family::StrixPoint));
        assert_eq!(Family::from_cpuid(0x19, 0x74), None);
        assert!(for_family(Family::StrixPoint).is_some());
    }

    #[test]
    fn the_writable_check_sees_a_locked_down_bus() {
        let mp1 = strix_point();
        let mut ok = SimSmu::new();
        assert!(writable(&mut ok, &mp1).unwrap());
        let mut locked = SimSmu::new();
        locked.writable = false;
        assert!(!writable(&mut locked, &mp1).unwrap());
    }

    #[test]
    fn an_all_core_request_reaches_the_simulated_smu() {
        let mp1 = strix_point();
        let mut smu = SimSmu::new();
        set_all_core(&mut smu, &mp1, -5).expect("accepted");
        assert_eq!(smu.all_core, -5);
        set_all_core(&mut smu, &mp1, 0).expect("accepted");
        assert_eq!(smu.all_core, 0);
    }

    #[test]
    fn per_core_requests_land_on_the_right_cores() {
        let mp1 = strix_point();
        let mut smu = SimSmu::new();
        set_per_core(&mut smu, &mp1, 0, -10).unwrap();
        set_per_core(&mut smu, &mp1, 7, -3).unwrap();
        assert_eq!(smu.per_core.get(&0), Some(&-10));
        assert_eq!(smu.per_core.get(&7), Some(&-3));
    }

    #[test]
    fn an_unknown_message_is_an_error() {
        let mp1 = strix_point();
        let mut smu = SimSmu::new();
        assert_eq!(
            request(&mut smu, &mp1, 0x999, 0).unwrap(),
            Response::UnknownCommand
        );
    }

    #[test]
    fn a_dead_mailbox_times_out() {
        let mp1 = strix_point();
        // No mailbox modelled: the response register never changes.
        let mut smu = SimSmu::new().with_mailbox(None);
        assert_eq!(
            request(&mut smu, &mp1, MSG_SET_ALL_CORE, 0).unwrap(),
            Response::TimedOut
        );
    }
}
