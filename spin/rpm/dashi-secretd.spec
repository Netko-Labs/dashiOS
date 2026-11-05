# dashi-secretd: Dashi's vault (docs/secrets.md), its PAM helper, and the
# Secret Service bridge apps talk to. Built by spin/build-rpms, which sets
# dashi_snapshot and dashi_source, and may define cargo_target.
%global debug_package %{nil}
%{!?cargo_target:%global cargo_target %{_builddir}/cargo-target}

Name:           dashi-secretd
Version:        %{dashi_snapshot}
Release:        1%{?dist}
Summary:        Dashi's vault: secrets agents can use but never read
License:        MIT
URL:            https://github.com/Netko-Labs/dashiOS
Source0:        %{dashi_source}.tar.gz
ExclusiveArch:  x86_64 aarch64

BuildRequires:  cargo >= 1.88
BuildRequires:  rust >= 1.88
BuildRequires:  systemd-rpm-macros

Requires:       systemd
# The PAM helper is run by pam_exec.
Requires:       pam
# The agent sandbox (dashi-agent, in the dashi package) and its bus filter.
Recommends:     xdg-dbus-proxy
Recommends:     tpm2-tss

%description
dashi-secretd keeps your passwords, app secrets and one-time code secrets in
a vault encrypted at rest (Argon2id and XChaCha20-Poly1305, the key wrapped by
the TPM where there is one), owned by its own system user. Your login opens
it. It refuses every caller in an agent's sandbox: agents sign in and enter
codes through Dashi, which types them, and never see the secret.
dashi-secret-bridge serves it to apps as the Secret Service
(org.freedesktop.secrets) and the portal's Secret.

%prep
%autosetup -n %{dashi_source}

%build
export CARGO_TARGET_DIR=%{cargo_target}
cargo build --release --locked -p dashi-secretd

%install
for bin in dashi-secretd dashi-secretd-pam dashi-secret-bridge; do
  install -Dm0755 %{cargo_target}/release/$bin %{buildroot}%{_libexecdir}/dashi/$bin
done
cp -a spin/dashi-secretd/usr/. %{buildroot}%{_prefix}/

%check
export CARGO_TARGET_DIR=%{cargo_target}
cargo test --release --locked -p dashi-secretd

%post
%systemd_post dashi-secretd.socket dashi-secretd.service
%systemd_user_post dashi-secret-bridge.service
# greetd's PAM file gets the vault's two lines (once): the login opens the vault.
pam=%{_sysconfdir}/pam.d/greetd
if [ -f "$pam" ] && ! grep -q dashi-secretd-pam "$pam"; then
  grep -v "^#" %{_datadir}/dashi/pam/dashi-secretd >> "$pam"
fi
systemctl enable --now dashi-secretd.socket >/dev/null 2>&1 || :

%preun
%systemd_preun dashi-secretd.socket dashi-secretd.service
if [ $1 -eq 0 ] && [ -f %{_sysconfdir}/pam.d/greetd ]; then
  sed -i "/dashi-secretd-pam/d" %{_sysconfdir}/pam.d/greetd || :
fi

%postun
%systemd_postun_with_restart dashi-secretd.service

%files
%dir %{_libexecdir}/dashi
%{_libexecdir}/dashi/dashi-secretd
%{_libexecdir}/dashi/dashi-secretd-pam
%{_libexecdir}/dashi/dashi-secret-bridge
%{_unitdir}/dashi-secretd.service
%{_unitdir}/dashi-secretd.socket
%{_userunitdir}/dashi-secret-bridge.service
# rpm makes the dashi-secret user from this file as it installs it.
%{_sysusersdir}/dashi-secretd.conf
%{_datadir}/dbus-1/services/dev.dashi.SecretService.service
%{_datadir}/dbus-1/services/dev.dashi.SecretPortal.service
%{_datadir}/xdg-desktop-portal/portals/dashi-secret.portal
%dir %{_datadir}/dashi
%dir %{_datadir}/dashi/pam
%{_datadir}/dashi/pam/dashi-secretd

%changelog
* Thu Nov 05 2026 PejeDev <hi@peje.dev> - 0.4.0
- New: Dashi's vault, the Secret Service bridge, and the login's PAM helper.
