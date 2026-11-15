//! What each voice measures: how loud it speaks and how high. Measured once
//! with `dashi-voice levels` (each voice says a line of its own language;
//! the level is the RMS of the sound that is speech, the pitch the median
//! of its fundamental) and written here. The level makes a sentence in one
//! voice as loud as the next in another; the pitch pairs a voice with the
//! one of another language that sounds nearest (service/voices.rs).

/// The level every voice is brought to (dBFS): Dashi's own voice's, `af_heart`.
const AIM_DB: f32 = -21.7;

/// A voice, its level (dBFS) and its pitch (Hz).
const MEASURED: &[(&str, f32, f32)] = &[
    ("af_heart", -21.7, 195.1),
    ("af_bella", -20.9, 201.7),
    ("af_nicole", -20.3, 151.9),
    ("am_michael", -22.5, 117.6),
    ("am_fenrir", -18.4, 143.7),
    ("am_puck", -17.4, 121.8),
    ("bf_emma", -19.2, 183.2),
    ("bm_george", -20.1, 147.2),
    ("bm_fable", -22.3, 127.0),
    ("ef_dora", -22.3, 180.5),
    ("em_alex", -21.6, 134.1),
    ("ff_siwis", -18.6, 208.7),
    ("hf_alpha", -14.7, 206.9),
    ("hm_omega", -15.4, 127.0),
    ("if_sara", -13.3, 224.3),
    ("im_nicola", -17.8, 94.1),
    ("pf_dora", -22.1, 186.0),
    ("pm_alex", -21.8, 134.8),
];

fn measured(voice: &str) -> Option<&'static (&'static str, f32, f32)> {
    MEASURED.iter().find(|(known, _, _)| *known == voice)
}

/// What a voice's samples are multiplied by; a voice not measured is left as the model made it.
pub(super) fn gain(voice: &str) -> f32 {
    measured(voice).map_or(1.0, |(_, db, _)| 10f32.powf((AIM_DB - db) / 20.0))
}

/// How far apart two voices' pitches are, in semitones; none when either was not measured.
pub(crate) fn semitones(from: &str, to: &str) -> Option<f32> {
    let (from, to) = (measured(from)?, measured(to)?);
    Some(12.0 * (to.2 / from.2).log2())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_voice_is_brought_to_dashis_own_level() {
        assert!((gain("af_heart") - 1.0).abs() < 1e-6);
        // The loudest is cut by 8.4 dB, the quietest raised by less than one: none is pushed to clip.
        assert!(
            (gain("if_sara") - 0.380).abs() < 0.005,
            "{}",
            gain("if_sara")
        );
        assert!(MEASURED.iter().all(|(voice, _, _)| gain(voice) < 1.1));
        assert_eq!(gain("zz_new"), 1.0);
    }

    #[test]
    fn every_voice_in_the_manifest_was_measured() {
        let set = crate::models::manifest::set(crate::models::manifest::SPEAK_SET).unwrap();
        let voices = set
            .files
            .iter()
            .filter_map(|file| file.path.strip_prefix("voices/")?.strip_suffix(".bin"));
        for voice in voices {
            assert!(measured(voice).is_some(), "{voice} has no measure");
        }
    }

    #[test]
    fn pitch_says_how_far_apart_two_voices_are() {
        let near = semitones("af_heart", "ef_dora").unwrap();
        assert!((near + 1.35).abs() < 0.05, "{near}");
        assert!(semitones("af_heart", "im_nicola").unwrap() < -12.0);
        assert_eq!(semitones("af_heart", "zz_new"), None);
    }
}
