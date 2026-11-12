# dashi-voice: Dashi's voice (docs/voice.md): speech to text and text to
# speech on this machine. Built by spin/build-rpms, which sets dashi_snapshot
# and dashi_source, and may define cargo_target.
#
# Nothing is downloaded while it builds but the crates, as for every other
# crate here: ONNX Runtime is Fedora's own package, found when the service
# first loads a model, so no library is linked or fetched at build time. The
# models are never in the package: the service fetches them when the person
# turns Voice on.
%global debug_package %{nil}
%{!?cargo_target:%global cargo_target %{_builddir}/cargo-target}

Name:           dashi-voice
Version:        %{dashi_snapshot}
Release:        1%{?dist}
Summary:        Dashi's voice: speech to text and text to speech on this machine
License:        BSD-3-Clause AND ISC AND MIT AND Unicode-3.0
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
ExclusiveArch:  x86_64 aarch64

BuildRequires:  cargo >= 1.88
BuildRequires:  rust >= 1.88
BuildRequires:  systemd-rpm-macros
# %%check fetches a file:// address with it.
BuildRequires:  curl

Requires:       systemd
# The models run on ONNX Runtime (MIT), loaded at run time.
Requires:       onnxruntime%{?_isa}
# The microphone and the speakers: pw-record and pw-play.
Requires:       pipewire-utils
# Words to phonemes for Kokoro: run as a program, never linked (GPL-3.0-or-later).
Requires:       espeak-ng
# Models are fetched with it.
Requires:       curl

%description
dashi-voice hears what you say while you hold the key (Silero VAD, Parakeet
TDT, and Whisper for more languages) and speaks in Dashi's voice (Kokoro),
with each word's time for captions. Everything runs on this machine: no sound
and no text leaves it. The models are not in this package; they are fetched,
pinned by SHA-256, when you turn Voice on, and can be removed again.

%prep
%autosetup -n %{dashi_source}

%build
export CARGO_TARGET_DIR=%{cargo_target}
cargo build --release --locked -p dashi-voice

%install
install -Dm0755 %{cargo_target}/release/dashi-voice %{buildroot}%{_libexecdir}/dashi/dashi-voice
cp -a spin/dashi-voice/usr/. %{buildroot}%{_prefix}/

%check
export CARGO_TARGET_DIR=%{cargo_target}
cargo test --release --locked -p dashi-voice

%post
%systemd_user_post dashi-voice.socket

%preun
%systemd_user_preun dashi-voice.socket dashi-voice.service

%postun
%systemd_user_postun_with_restart dashi-voice.service

%files
%license LICENSE
%license spin/dashi-voice/usr/share/licenses/dashi-voice/LICENSE.dependencies
%dir %{_libexecdir}/dashi
%{_libexecdir}/dashi/dashi-voice
%{_userunitdir}/dashi-voice.service
%{_userunitdir}/dashi-voice.socket
%{_userpresetdir}/80-dashi-voice.preset

%changelog
* Wed Nov 11 2026 PejeDev <hi@peje.dev> - 0.8.0
- New: Dashi's voice, a user service for speech to text and text to speech.
