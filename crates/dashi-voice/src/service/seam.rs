//! Where the pieces of an utterance meet: the hush the model puts around
//! each piece is cut where it only delays, and where one voice hands over
//! to another, so the change has no gap of its own and no click.

use super::lines::Line;
use crate::engine::Spoken;

/// The hush kept before the first sound of an utterance, and at each side of
/// the join of a sentence said in two pieces (a comma's pause in all).
const LEAD_MS: u64 = 30;
const JOIN_MS: u64 = 120;

/// Where one voice hands over to another, the hush each keeps: a
/// sentence's pause in all (450 ms), whichever two voices meet. Left as the
/// model made it the pause there would be 340 to 760 ms by the pair.
const SEAM_AFTER_MS: u64 = 300;
const SEAM_BEFORE_MS: u64 = 150;

/// Which sides of a piece meet another voice.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Seam {
    pub(crate) before: bool,
    pub(crate) after: bool,
}

/// The seams of each line: where the voice before or after it is another.
pub(crate) fn seams(lines: &[Line]) -> Vec<Seam> {
    let other = |a: usize, b: usize| lines[a].voice != lines[b].voice;
    (0..lines.len())
        .map(|at| Seam {
            before: at > 0 && other(at - 1, at),
            after: at + 1 < lines.len() && other(at, at + 1),
        })
        .collect()
}

/// A piece without the hush that only delays: the model starts each piece
/// with a third of a second of it, which the first sound of an utterance
/// waited through, and ends each with half a second, which would make a
/// sentence said in two pieces stop for most of a second at its comma. At a
/// seam the hush is cut to a sentence's pause and its edge faded, so the
/// change of voice has no gap of its own and no click.
pub(crate) fn joined(mut spoken: Spoken, index: usize, cut: bool, seam: Seam) -> Spoken {
    if index == 0 || (cut && index == 1) {
        spoken.trim_start(LEAD_MS);
    } else if seam.before {
        spoken.trim_start(SEAM_BEFORE_MS);
        spoken.fade(true);
    }
    if cut && index == 0 {
        spoken.trim_end(JOIN_MS);
    } else if seam.after {
        spoken.trim_end(SEAM_AFTER_MS);
        spoken.fade(false);
    }
    spoken
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::SPEAK_RATE;

    fn line(voice: &str) -> Line {
        Line {
            text: "Hi.".into(),
            voice: voice.into(),
            tag: None,
        }
    }

    /// 400 ms of hush, 500 ms of sound, 600 ms of hush.
    fn piece() -> Spoken {
        let ms = |ms: usize| ms * SPEAK_RATE as usize / 1000;
        let mut samples = vec![0.001; ms(400)];
        samples.extend(vec![0.3; ms(500)]);
        samples.extend(vec![0.001; ms(600)]);
        Spoken {
            samples,
            ..Spoken::default()
        }
    }

    fn ms(spoken: &Spoken) -> usize {
        spoken.samples.len() * 1000 / SPEAK_RATE as usize
    }

    #[test]
    fn a_seam_is_where_the_voice_changes() {
        let lines = [
            line("af_heart"),
            line("ef_dora"),
            line("ef_dora"),
            line("af_heart"),
        ];
        let seam = |before, after| Seam { before, after };
        assert_eq!(
            seams(&lines),
            vec![
                seam(false, true),
                seam(true, false),
                seam(false, true),
                seam(true, false)
            ]
        );
        assert!(seams(&[]).is_empty());
    }

    #[test]
    fn at_a_seam_the_hush_is_a_sentences_pause_and_its_edges_start_from_nothing() {
        let both = Seam {
            before: true,
            after: true,
        };
        let spoken = joined(piece(), 2, false, both);
        assert_eq!(ms(&spoken), 150 + 500 + 300);
        assert_eq!(spoken.samples.first(), Some(&0.0));
        assert_eq!(spoken.samples.last(), Some(&0.0));
        // With the same voice on both sides it is left as the model made it.
        assert_eq!(ms(&joined(piece(), 2, false, Seam::default())), 1500);
        // The first sound of an utterance still waits 30 ms and no more; its end meets the next voice.
        let after = Seam {
            before: false,
            after: true,
        };
        assert_eq!(ms(&joined(piece(), 0, false, after)), 30 + 500 + 300);
        // A sentence said in two parts keeps its comma's pause, seam or not.
        assert_eq!(ms(&joined(piece(), 0, true, after)), 30 + 500 + 120);
    }
}
