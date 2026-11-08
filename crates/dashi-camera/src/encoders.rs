//! Which encoders a recording uses: the Radeon's (VA-API) when GStreamer has
//! them, H.264 first (every player plays it), then AV1; else software, H.264
//! through Cisco's OpenH264 (BSD-2-Clause), then AV1 through SVT-AV1
//! (BSD-3-Clause-Clear) or libaom (BSD-2-Clause). Never x264 (GPL): it is
//! not on the list, so it is never loaded into this process. The sound is
//! Opus (libopus, BSD-3-Clause). All of it goes into an MP4.
//!
//! The choice is a pure function of which GStreamer elements exist, so it is
//! tested without a camera (and `DASHI_CAMERA_ENCODER` forces one, to try
//! the software path on a machine that has VA-API).

/// A video encoder and what goes around it.
#[derive(Debug, PartialEq)]
pub struct VideoEncoder {
    /// The GStreamer element.
    pub element: &'static str,
    /// What gets raw frames into it: `vapostproc` uploads to the GPU and converts there.
    pub convert: &'static str,
    /// The parser between it and the MP4 muxer.
    pub parser: &'static str,
    /// Runs on the GPU's encoder.
    pub hardware: bool,
    /// Properties set on it (as GStreamer parses them from strings); one that is missing is skipped.
    pub props: &'static [(&'static str, &'static str)],
}

pub const VIDEO: &[VideoEncoder] = &[
    VideoEncoder {
        element: "vah264enc",
        convert: "vapostproc",
        parser: "h264parse",
        hardware: true,
        props: &[("key-int-max", "60")],
    },
    VideoEncoder {
        element: "vah264lpenc",
        convert: "vapostproc",
        parser: "h264parse",
        hardware: true,
        props: &[("key-int-max", "60")],
    },
    VideoEncoder {
        element: "vaav1enc",
        convert: "vapostproc",
        parser: "av1parse",
        hardware: true,
        props: &[("key-int-max", "60")],
    },
    VideoEncoder {
        element: "vaapih264enc",
        convert: "videoconvert",
        parser: "h264parse",
        hardware: true,
        props: &[("keyframe-period", "60")],
    },
    VideoEncoder {
        element: "openh264enc",
        convert: "videoconvert",
        parser: "h264parse",
        hardware: false,
        // Its default is 128 kbit/s, which smears a face; 6 Mbit/s is good 720p.
        props: &[
            ("bitrate", "6000000"),
            ("rate-control", "bitrate"),
            ("gop-size", "60"),
        ],
    },
    VideoEncoder {
        element: "svtav1enc",
        convert: "videoconvert",
        parser: "av1parse",
        hardware: false,
        props: &[("preset", "10")],
    },
    VideoEncoder {
        element: "av1enc",
        convert: "videoconvert",
        parser: "av1parse",
        hardware: false,
        props: &[("usage-profile", "realtime"), ("cpu-used", "8")],
    },
];

/// The audio encoder, when there is one.
pub const AUDIO: &[&str] = &["opusenc"];
/// What every recording needs besides an encoder.
pub const MUXER: &str = "mp4mux";

/// The first encoder `has` (whether GStreamer has an element) offers, with its parser and converter;
/// `force` names one to use instead (it must still exist).
pub fn video(has: &dyn Fn(&str) -> bool, force: Option<&str>) -> Option<&'static VideoEncoder> {
    VIDEO
        .iter()
        .filter(|encoder| force.is_none_or(|name| encoder.element == name))
        .find(|encoder| has(encoder.element) && has(encoder.parser) && has(encoder.convert))
}

/// The sound's encoder, or None (the video is recorded silent).
pub fn audio(has: &dyn Fn(&str) -> bool) -> Option<&'static str> {
    AUDIO.iter().copied().find(|name| has(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(names: &'static [&'static str]) -> impl Fn(&str) -> bool {
        move |name| names.contains(&name)
    }

    const BASE: &[&str] = &["videoconvert", "h264parse", "av1parse"];

    #[test]
    fn the_radeon_first_h264_before_av1() {
        let has = with(&[
            "videoconvert",
            "vapostproc",
            "h264parse",
            "av1parse",
            "vah264enc",
            "vaav1enc",
            "openh264enc",
        ]);
        let chosen = video(&has, None).map(|e| e.element);
        assert_eq!(chosen, Some("vah264enc"));
        let av1 = with(&[
            "videoconvert",
            "vapostproc",
            "av1parse",
            "h264parse",
            "vaav1enc",
            "openh264enc",
        ]);
        assert_eq!(video(&av1, None).map(|e| e.element), Some("vaav1enc"));
    }

    #[test]
    fn software_when_va_api_is_missing() {
        let has = |name: &str| BASE.contains(&name) || name == "openh264enc" || name == "svtav1enc";
        let chosen = video(&has, None).expect("an encoder");
        assert_eq!(chosen.element, "openh264enc");
        assert!(!chosen.hardware);
        // A VA encoder without vapostproc to feed it is no use.
        let no_postproc =
            |name: &str| BASE.contains(&name) || name == "vah264enc" || name == "svtav1enc";
        assert_eq!(
            video(&no_postproc, None).map(|e| e.element),
            Some("svtav1enc")
        );
    }

    #[test]
    fn x264_is_never_chosen() {
        assert!(VIDEO.iter().all(|e| !e.element.contains("x264")));
        let has = |name: &str| BASE.contains(&name) || name == "x264enc";
        assert_eq!(video(&has, None), None);
    }

    #[test]
    fn a_forced_encoder_must_exist() {
        let has = |name: &str| {
            BASE.contains(&name) || ["vapostproc", "vah264enc", "openh264enc"].contains(&name)
        };
        assert_eq!(
            video(&has, Some("openh264enc")).map(|e| e.element),
            Some("openh264enc")
        );
        assert_eq!(video(&has, Some("svtav1enc")), None);
    }

    #[test]
    fn opus_or_silence() {
        assert_eq!(audio(&|name| name == "opusenc"), Some("opusenc"));
        assert_eq!(audio(&|_| false), None);
    }
}
