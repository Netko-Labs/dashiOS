# dashi-term: the engine behind Dashi's Terminal (crates/dashi-term): a PTY
# and libghostty-vt, Ghostty's terminal core. The Terminal app itself is in
# the dashi package (packages/shell/apps/terminal). Built by spin/build-rpms,
# which sets dashi_snapshot and dashi_source in the SRPM's spec, and may
# define cargo_target; elsewhere (COPR) Cargo builds in the build dir.
%global debug_package %{nil}
%{!?cargo_target:%global cargo_target %{_builddir}/cargo-target}

Name:           dashi-term
Version:        %{dashi_snapshot}
Release:        1%{?dist}
Summary:        Dashi's terminal engine, on Ghostty's terminal core
License:        MIT AND Unicode-3.0
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
ExclusiveArch:  x86_64

BuildRequires:  cargo >= 1.88
BuildRequires:  rust >= 1.88
BuildRequires:  libghostty-vt-devel >= 1.4.0

%description
dashi-term runs the shell on a pseudo-terminal and keeps the terminal's
state in libghostty-vt (escape sequences, scrollback, reflow, key encoding,
selection), streaming what to draw to Dashi's Terminal app.

%prep
%autosetup -n %{dashi_source}

%build
# Network is needed for the crates (no vendored sources); a local rpmbuild has it.
export CARGO_TARGET_DIR=%{cargo_target}-term
cargo build --release --locked --manifest-path crates/dashi-term/Cargo.toml

%install
install -Dm0755 %{cargo_target}-term/release/dashi-term %{buildroot}%{_libexecdir}/dashi/dashi-term

%check
export CARGO_TARGET_DIR=%{cargo_target}-term
cargo test --release --locked --manifest-path crates/dashi-term/Cargo.toml

%files
%license LICENSE
%license spin/dashi-term/usr/share/licenses/dashi-term/LICENSE.dependencies
%{_libexecdir}/dashi/dashi-term

%changelog
* Mon Nov 02 2026 PejeDev <hi@peje.dev> - 0.2.0
- The terminal engine on libghostty-vt.
