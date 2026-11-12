//! The models: every file Voice may fetch, where from, how big, and the
//! SHA-256 it must have. The addresses name a commit, so a file can never
//! change under its hash. Nothing here is in Dashi's packages: the files are
//! fetched when the person turns Voice on (docs/voice.md, "The models").
//!
//! Licences, weights included: Silero VAD MIT; Parakeet TDT 0.6B v3
//! CC-BY-4.0 (NVIDIA; credited in THIRD-PARTY-NOTICES.md); Kokoro 82M
//! Apache-2.0; Whisper large-v3-turbo MIT.

pub(crate) struct File {
    /// Where it is kept, under the set's folder.
    pub(crate) path: &'static str,
    pub(crate) url: &'static str,
    pub(crate) bytes: u64,
    pub(crate) sha256: &'static str,
}

pub(crate) struct Set {
    pub(crate) id: &'static str,
    pub(crate) name: &'static str,
    /// What it is for, in a line.
    pub(crate) about: &'static str,
    /// Who made the models, and their licences, in words for Settings.
    pub(crate) credit: &'static str,
    /// Fetched when the person turns Voice on; the others only when asked for.
    pub(crate) basic: bool,
    pub(crate) files: &'static [File],
}

macro_rules! hf {
    ($repo:literal, $commit:literal, $($file:literal),+) => {
        concat!("https://huggingface.co/", $repo, "/resolve/", $commit, "/", $($file),+)
    };
}

macro_rules! parakeet {
    ($file:literal) => {
        hf!(
            "istupakov/parakeet-tdt-0.6b-v3-onnx",
            "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce",
            $file
        )
    };
}

macro_rules! kokoro {
    ($($file:literal),+) => {
        hf!("onnx-community/Kokoro-82M-v1.0-ONNX-timestamped", "dd4401a9add81ac692d20e240d22ec9dda82cc29", $($file),+)
    };
}

macro_rules! whisper {
    ($file:literal) => {
        hf!(
            "csukuangfj/sherpa-onnx-whisper-turbo",
            "2ca6ff69fc878651b770880507669577ac41c2ff",
            $file
        )
    };
}

macro_rules! voice {
    ($name:literal, $sha256:literal) => {
        File {
            path: concat!("voices/", $name, ".bin"),
            url: kokoro!("voices/", $name, ".bin"),
            bytes: 522_240,
            sha256: $sha256,
        }
    };
}

const LISTEN: &[File] = &[
    File {
        path: "silero-vad.onnx",
        url: hf!(
            "onnx-community/silero-vad",
            "e71cae966052b992a7eca6b17738916ce0eca4ec",
            "onnx/model.onnx"
        ),
        bytes: 2_243_022,
        sha256: "a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808",
    },
    File {
        path: "parakeet/nemo128.onnx",
        url: parakeet!("nemo128.onnx"),
        bytes: 139_764,
        sha256: "a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f",
    },
    File {
        path: "parakeet/vocab.txt",
        url: parakeet!("vocab.txt"),
        bytes: 93_939,
        sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
    },
    File {
        path: "parakeet/decoder_joint-model.int8.onnx",
        url: parakeet!("decoder_joint-model.int8.onnx"),
        bytes: 18_202_004,
        sha256: "eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70",
    },
    File {
        path: "parakeet/encoder-model.int8.onnx",
        url: parakeet!("encoder-model.int8.onnx"),
        bytes: 652_183_999,
        sha256: "6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09",
    },
];

const SPEAK: &[File] = &[
    File {
        path: "kokoro.onnx",
        // The full-precision file: the 16-bit one (half the size) is silent on
        // some sentences, and the 8-bit one is three times slower on a CPU.
        url: kokoro!("onnx/model.onnx"),
        bytes: 325_532_171,
        sha256: "651ea8291843a92276a4a003581a215cb07d15e47dde6fcfb1b768f9a1682054",
    },
    voice!(
        "af_heart",
        "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b"
    ),
    voice!(
        "af_bella",
        "f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b"
    ),
    voice!(
        "af_nicole",
        "cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a"
    ),
    voice!(
        "am_michael",
        "1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1"
    ),
    voice!(
        "am_fenrir",
        "c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43"
    ),
    voice!(
        "am_puck",
        "fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0"
    ),
    voice!(
        "bf_emma",
        "669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73"
    ),
    voice!(
        "bm_george",
        "c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc"
    ),
    voice!(
        "bm_fable",
        "f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1"
    ),
    voice!(
        "ef_dora",
        "f66ec66bd295acb18372e37008533a9a3228483ccd294e7538d5d9294ac9a532"
    ),
    voice!(
        "em_alex",
        "27809e9eafdcbcfff90a3016c697568676531de2a2c39cee29c96c7bd6b83e95"
    ),
    voice!(
        "ff_siwis",
        "a35f5675ad08948e326ae75fd0ea16ba5d0042e4f76b5f3d1df77d0a48c54861"
    ),
    voice!(
        "hf_alpha",
        "040be6a4425411cc01fda5fd06693c76bfa78572632852bc8cda9c99232ffb56"
    ),
    voice!(
        "hm_omega",
        "b02d9222d9ed00ce26b302173a862c2c93f96cc40b5c422b8d14910b9ff34137"
    ),
    voice!(
        "if_sara",
        "409b69248798fcdc2542330c76953d230710f19b057e59cb82fdc3c4cf71265c"
    ),
    voice!(
        "im_nicola",
        "bc578e510d52a96d6940d46f12e96d7b3df00905dbea075113226d100e6e1ab0"
    ),
    voice!(
        "pf_dora",
        "3da7b5b2d91847ebf5646f57631af6ececae3c29a89cd300f06edf9aa6cfe9ee"
    ),
    voice!(
        "pm_alex",
        "0175c753f59c54e7fd5a995bedef0c5ff2fb67e0043dd3dcb2ae74ec2acbeb2a"
    ),
];

const WHISPER: &[File] = &[
    File {
        path: "turbo-tokens.txt",
        url: whisper!("turbo-tokens.txt"),
        bytes: 816_730,
        sha256: "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126",
    },
    File {
        path: "turbo-decoder.int8.onnx",
        url: whisper!("turbo-decoder.int8.onnx"),
        bytes: 361_080_764,
        sha256: "20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547",
    },
    File {
        path: "turbo-encoder.int8.onnx",
        url: whisper!("turbo-encoder.int8.onnx"),
        bytes: 674_716_297,
        sha256: "b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b",
    },
];

pub(crate) const LISTEN_SET: &str = "listen";
pub(crate) const SPEAK_SET: &str = "speak";
pub(crate) const WHISPER_SET: &str = "whisper";

pub(crate) const SETS: [Set; 3] = [
    Set {
        id: LISTEN_SET,
        name: "Listening",
        about: "Hears what you say in 25 European languages.",
        credit: "Parakeet TDT 0.6B v3 by NVIDIA (CC BY 4.0), ONNX export by Ilya Stupakov; Silero VAD by the Silero team (MIT).",
        basic: true,
        files: LISTEN,
    },
    Set {
        id: SPEAK_SET,
        name: "Speaking",
        about: "Dashi's voice, in English, Spanish, French, Italian, Portuguese and Hindi.",
        credit: "Kokoro 82M by hexgrad (Apache 2.0), ONNX export by the ONNX community.",
        basic: true,
        files: SPEAK,
    },
    Set {
        id: WHISPER_SET,
        name: "More languages",
        about: "Hears the languages the first model lacks: Japanese, Chinese, Korean, Arabic, Hindi, Turkish and more.",
        credit: "Whisper large-v3-turbo by OpenAI (MIT), ONNX export by the sherpa-onnx project.",
        basic: false,
        files: WHISPER,
    },
];

pub(crate) fn set(id: &str) -> Option<&'static Set> {
    SETS.iter().find(|set| set.id == id)
}

impl Set {
    pub(crate) fn bytes(&self) -> u64 {
        self.files.iter().map(|file| file.bytes).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_file_is_pinned_to_a_commit_and_a_hash() {
        let mut paths = std::collections::HashSet::new();
        for set in &SETS {
            assert!(!set.files.is_empty());
            for file in set.files {
                // "resolve/<40 hex>/": a commit, never a branch that can move.
                let commit = file
                    .url
                    .split("/resolve/")
                    .nth(1)
                    .and_then(|rest| rest.split('/').next());
                assert!(
                    commit
                        .is_some_and(|c| c.len() == 40 && c.chars().all(|x| x.is_ascii_hexdigit())),
                    "{}",
                    file.url
                );
                assert!(file.url.starts_with("https://huggingface.co/"));
                assert_eq!(file.sha256.len(), 64, "{}", file.path);
                assert!(
                    file.sha256
                        .chars()
                        .all(|x| x.is_ascii_hexdigit() && !x.is_ascii_uppercase())
                );
                assert!(file.bytes > 0);
                // A path stays inside its set's folder, and is used once.
                assert!(!file.path.starts_with('/') && !file.path.contains(".."));
                assert!(paths.insert((set.id, file.path)), "{} twice", file.path);
            }
        }
    }

    #[test]
    fn the_sizes_are_what_settings_will_say() {
        assert_eq!(set(LISTEN_SET).map(Set::bytes), Some(672_862_728));
        assert_eq!(set(SPEAK_SET).map(Set::bytes), Some(334_932_491));
        assert_eq!(set(WHISPER_SET).map(Set::bytes), Some(1_036_613_791));
        assert!(set("other").is_none());
    }
}
