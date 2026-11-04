//! Pointer constraints carried out: a locked pointer stays where it is (the
//! client hears only relative motion), a confined one stays inside its
//! surface's region. A constraint takes hold when the pointer is over its
//! surface and inside its region.

use smithay::{
    input::pointer::PointerHandle,
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    utils::{Logical, Point},
    wayland::pointer_constraints::{PointerConstraint, with_pointer_constraint},
};

use crate::state::Dashi;

/// What holds the pointer where it is now.
pub(crate) enum Hold {
    Free,
    Locked,
    /// Kept on `surface` (whose origin is at `origin`), within `region` if any.
    Confined {
        surface: WlSurface,
        origin: Point<f64, Logical>,
        region: Option<smithay::wayland::compositor::RegionAttributes>,
    },
}

impl Dashi {
    /// The active constraint on the surface under `at`, if `at` is inside its region.
    pub(crate) fn hold_at(
        &self,
        pointer: &PointerHandle<Self>,
        under: Option<&(WlSurface, Point<f64, Logical>)>,
        at: Point<f64, Logical>,
    ) -> Hold {
        let Some((surface, origin)) = under else {
            return Hold::Free;
        };
        with_pointer_constraint(surface, pointer, |constraint| {
            let Some(constraint) = constraint.filter(|c| c.is_active()) else {
                return Hold::Free;
            };
            let local = (at - *origin).to_i32_round();
            if !constraint
                .region()
                .is_none_or(|region| region.contains(local))
            {
                return Hold::Free;
            }
            match &*constraint {
                PointerConstraint::Locked(_) => Hold::Locked,
                PointerConstraint::Confined(confined) => Hold::Confined {
                    surface: surface.clone(),
                    origin: *origin,
                    region: confined.region().cloned(),
                },
            }
        })
    }

    /// Whether a confined pointer may go to `to` (over `under`).
    pub(crate) fn hold_allows(
        hold: &Hold,
        to: Point<f64, Logical>,
        under: Option<&(WlSurface, Point<f64, Logical>)>,
    ) -> bool {
        match hold {
            Hold::Free => true,
            Hold::Locked => false,
            Hold::Confined {
                surface,
                origin,
                region,
            } => {
                under.is_some_and(|(s, _)| s == surface)
                    && region
                        .as_ref()
                        .is_none_or(|region| region.contains((to - *origin).to_i32_round()))
            }
        }
    }

    /// The pointer arrived over `under`: its constraint, if any, takes hold.
    pub(crate) fn activate_hold(
        &self,
        pointer: &PointerHandle<Self>,
        under: Option<&(WlSurface, Point<f64, Logical>)>,
        at: Point<f64, Logical>,
    ) {
        let Some((surface, origin)) = under else {
            return;
        };
        with_pointer_constraint(surface, pointer, |constraint| {
            if let Some(constraint) = constraint.filter(|c| !c.is_active()) {
                let local = (at - *origin).to_i32_round();
                if constraint
                    .region()
                    .is_none_or(|region| region.contains(local))
                {
                    constraint.activate();
                }
            }
        });
    }
}
