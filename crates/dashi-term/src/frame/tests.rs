//! Cells joining into spans.

use super::spans::push_cell;
use crate::protocol::Span;

fn cell(s: &str, x: u16, w: u16) -> Span {
    Span {
        s: s.into(),
        x,
        w,
        ..Span::default()
    }
}

fn row(cells: Vec<Span>) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut run = false;
    for each in cells {
        push_cell(&mut spans, &mut run, each);
    }
    spans
}

#[test]
fn plain_cells_run_together_and_wide_ones_stand_alone() {
    let spans = row(vec![
        cell("l", 0, 1),
        cell("s", 1, 1),
        cell("界", 2, 2),
        cell("─", 4, 1),
        cell("─", 5, 1),
        cell("🙂", 6, 2),
        cell("a", 8, 1),
    ]);
    let shape: Vec<(&str, u16, u16)> = spans.iter().map(|s| (s.s.as_str(), s.x, s.w)).collect();
    assert_eq!(
        shape,
        vec![
            ("ls", 0, 2),
            ("界", 2, 2),
            ("──", 4, 2),
            ("🙂", 6, 2),
            ("a", 8, 1)
        ]
    );
}

#[test]
fn icons_and_gaps_break_runs() {
    let spans = row(vec![
        cell("a", 0, 1),
        cell("\u{e0b0}", 1, 1),
        cell("b", 2, 1),
        // Column 3 was a spacer, skipped.
        cell("c", 4, 1),
    ]);
    let shape: Vec<(&str, u16)> = spans.iter().map(|s| (s.s.as_str(), s.x)).collect();
    assert_eq!(shape, vec![("a", 0), ("\u{e0b0}", 1), ("b", 2), ("c", 4)]);
}

#[test]
fn a_new_look_starts_a_span() {
    let mut bold = cell("b", 1, 1);
    bold.b = true;
    let spans = row(vec![cell("a", 0, 1), bold]);
    assert_eq!(spans.len(), 2);
}
