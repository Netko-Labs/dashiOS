//! Panes that share one blur: a run of one surface's panes, next to each
//! other in a screen's elements (nothing drawn between them), with the same
//! blur, side by side and never over one another (the widget column's cards,
//! a sheet's rows). What is behind them is the same for all, so it is drawn
//! once, over all of them and the blur's reach round them, and blurred once;
//! each pane takes its part. Frosted one by one, each card drew and blurred
//! its own backdrop, the blur's reach (some 150 pixels a side for paper) over
//! and over: the column cost twice and a half what one picture of it does.
//!
//! A pane over another of the run is not in it: it must see the one under it
//! frosted (GL-2), so it starts a run of its own.

use smithay::utils::{Physical, Rectangle};

use super::element::{GlassElement, Owner};

/// What decides whether two panes share a blur.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Sharing<'a> {
    pub owner: &'a Owner,
    pub blur: f64,
    pub xray: bool,
    /// What of the pane shows, on the screen.
    pub shown: Rectangle<i32, Physical>,
}

impl<'a> Sharing<'a> {
    pub(super) fn of(glass: &'a GlassElement) -> Self {
        Self {
            owner: &glass.key.owner,
            blur: glass.look.blur,
            xray: glass.look.xray,
            shown: glass.visible(),
        }
    }

    fn with(&self, other: &Self) -> bool {
        self.owner == other.owner && self.blur == other.blur && self.xray == other.xray
    }
}

/// Where the run that ends at `at` (the backmost of it) starts: the frontmost index it reaches
/// toward the front of the list. `pane(i)` is the element at `i` if it is a pane of glass.
/// `at` itself when it is alone, or no pane.
pub(super) fn run_start<'a>(at: usize, pane: impl Fn(usize) -> Option<Sharing<'a>>) -> usize {
    let Some(last) = pane(at) else {
        return at;
    };
    let mut kept = vec![last.shown];
    let mut start = at;
    while start > 0 {
        let Some(next) = pane(start - 1) else {
            break;
        };
        if !next.with(&last) || kept.iter().any(|shown| shown.overlaps(next.shown)) {
            break;
        }
        kept.push(next.shown);
        start -= 1;
    }
    start
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, w: i32, h: i32) -> Rectangle<i32, Physical> {
        Rectangle::new((x, y).into(), (w, h).into())
    }

    #[test]
    fn a_column_of_cards_shares_one_blur_and_a_card_over_another_does_not() {
        let column = Owner::Shell("dashi.notifications".into());
        let bar = Owner::Shell("dashi.bar".into());
        let card = |y: i32, h: i32| Sharing {
            owner: &column,
            blur: 52.5,
            xray: false,
            shown: rect(1270, y, 620, h),
        };
        // Front to back: a menu over the column's top card, then the column's five cards, then
        // the bar, as a screen's elements list them.
        let menu = Sharing {
            shown: rect(1300, 80, 200, 300),
            ..card(0, 0)
        };
        let list = [
            Some(menu),
            Some(card(70, 120)),
            Some(card(200, 190)),
            Some(card(400, 620)),
            Some(Sharing {
                shown: rect(1270, 1030, 300, 30),
                ..card(0, 0)
            }),
            Some(Sharing {
                shown: rect(1590, 1030, 300, 30),
                ..card(0, 0)
            }),
            None,
            Some(Sharing {
                owner: &bar,
                blur: 31.5,
                ..card(0, 30)
            }),
        ];
        let pane = |i: usize| list[i].clone();
        // The cards from the backmost (index 5) to the top card (1): one run; the menu is over
        // the top card, so it stays out.
        assert_eq!(run_start(5, pane), 1);
        assert_eq!(run_start(0, pane), 0);
        // The bar is another surface's, and alone; a surface between breaks a run.
        assert_eq!(run_start(7, pane), 7);
        assert_eq!(run_start(6, pane), 6);
    }
}
