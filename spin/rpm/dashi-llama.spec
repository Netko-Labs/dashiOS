# dashi-llama: llama.cpp's server, the separate program that runs the small
# model which corrects dictation (docs/dictation-rewrite.md). MIT. Dashi only
# starts it and talks to it over a Unix socket; nothing of it is linked into
# Dashi. Built by spin/build-rpms, which sets dashi_source (the licence list
# comes from Dashi's tree).
#
# Why not Fedora's own llama-cpp: Fedora 44 has build 6153, which is older
# than the models Dashi uses and is built for ROCm (it pulls hipblas). This
# package builds the pinned commit the measurements ran on
# (dashi-0.9.0-review/24-rewrite), for the processor only, and installs only
# the server, under Dashi's own libexec folder, so it never clashes with
# Fedora's package.
#
# The processor only (decisions.md D171, D191): no Vulkan backend is built,
# so the build needs no shader compiler and the server can reach no graphics
# card. A processor backend for each x86-64 level is built and the right one
# is picked when the server starts, never the builder's own CPU.
#
# The model is never in the package: dashi-voice fetches it when the person
# asks for it in Settings › Voice.
%global debug_package %{nil}
# Its libraries are its own, beside the server: they are not the system's
# libllama or libggml, so the package neither offers them to others nor asks
# the system for them.
%global __provides_exclude_from ^%{_libexecdir}/dashi/llama/.*$
%global __requires_exclude ^lib(llama|ggml|mtmd).*\\.so.*$
%global llama_build 12359
%global llama_commit b1b770d90d94cad9e9ea5b993bdbc383a522fb28
%global llama_short b1b770d90
%global llama_sha256 ae8556670b17c25931cd39eb7c95617650eaf6091bbcff206750583ddde1acb4

Name:           dashi-llama
Version:        1.0.0~b%{llama_build}
Release:        2%{?dist}
Summary:        llama.cpp's server, for the model that corrects Dashi's dictation
# llama.cpp and ggml are MIT. Built in with them (LICENSE.dependencies has each):
# nlohmann/json, cpp-httplib, rotate-bits and stb_image (MIT), xxHash
# (BSD-2-Clause), miniaudio (MIT-0), subprocess.h (Unlicense), sha1 and sha256
# (public domain).
License:        MIT AND BSD-2-Clause AND MIT-0 AND Unlicense AND LicenseRef-Fedora-Public-Domain
URL:            https://github.com/ggml-org/llama.cpp
Source0:        https://github.com/ggml-org/llama.cpp/archive/%{llama_commit}.tar.gz#/llama.cpp-%{llama_commit}.tar.gz
Source1:        %{dashi_source}.tar.gz
ExclusiveArch:  x86_64 aarch64

BuildRequires:  cmake
BuildRequires:  gcc-c++
BuildRequires:  ninja-build

%description
llama.cpp's llama-server, built for the processor (a backend for each x86-64
level, chosen when it starts) and installed where only Dashi looks for it
(/usr/libexec/dashi/llama). Dashi starts it as a unit of your session when
you dictate, on a Unix socket only you can open, with no network, and stops
it after ten idle minutes. It has no graphics backend and no web page.

%prep
# The source is the commit the measurements used, to the byte.
echo "%{llama_sha256}  %{SOURCE0}" | sha256sum -c -
%setup -q -n llama.cpp-%{llama_commit}
mkdir dashi
tar -xzf %{SOURCE1} -C dashi --strip-components=1 \
  %{dashi_source}/spin/dashi-llama/usr/share/licenses/dashi-llama/LICENSE.dependencies

%build
# Nothing is fetched while it builds: no prebuilt web UI (its default), no
# web UI at all, no OpenSSL (the server speaks to a Unix socket only), no
# unified binary, no llama-connect. The tarball has no .git, so the build's
# number and commit are given. The libraries are copied from the build tree,
# so they are linked there with the path they are installed with ($ORIGIN),
# never the builder's folder.
cmake -S . -B build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_RPATH='$ORIGIN' \
  -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
  -DBUILD_SHARED_LIBS=ON \
  -DGGML_NATIVE=OFF \
  -DGGML_BACKEND_DL=ON \
  -DGGML_CPU_ALL_VARIANTS=ON \
  -DGGML_VULKAN=OFF \
  -DLLAMA_OPENSSL=OFF \
  -DLLAMA_USE_PREBUILT_UI=OFF \
  -DLLAMA_BUILD_UI=OFF \
  -DLLAMA_BUILD_APP=OFF \
  -DLLAMA_CONNECT=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_TOOLS=ON \
  -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_BUILD_NUMBER=%{llama_build} \
  -DLLAMA_BUILD_COMMIT=%{llama_short}
cmake --build build --target llama-server %{?_smp_mflags}

%install
install -d %{buildroot}%{_libexecdir}/dashi/llama
install -m0755 build/bin/llama-server %{buildroot}%{_libexecdir}/dashi/llama/
# The libraries the server loads, beside it (its rpath is $ORIGIN): llama,
# its common and server halves, mtmd, ggml and one processor backend a level.
find build/bin -maxdepth 1 \( -name 'libllama*.so*' -o -name 'libggml*.so*' -o -name 'libmtmd*.so*' \) \
  -exec cp -a {} %{buildroot}%{_libexecdir}/dashi/llama/ \;
# The notices of what is built in, each under its part's name.
notices=%{buildroot}%{_datadir}/licenses/%{name}
install -d "$notices"
install -m0644 LICENSE "$notices/LICENSE"
install -m0644 dashi/spin/dashi-llama/usr/share/licenses/dashi-llama/LICENSE.dependencies "$notices/"
install -m0644 licenses/LICENSE-jsonhpp "$notices/"
install -m0644 vendor/cpp-httplib/LICENSE "$notices/LICENSE-cpp-httplib"
install -m0644 vendor/hash/xxhash/LICENSE "$notices/LICENSE-xxhash"
install -m0644 vendor/hash/rotate-bits/LICENSE.md "$notices/LICENSE-rotate-bits"
install -m0644 vendor/hash/sha256/LICENSE "$notices/LICENSE-sha256"
# Three keep their text inside the one file they are.
sed -n '/^This software is available under 2 licenses/,$p' vendor/stb/stb_image.h > "$notices/LICENSE-stb"
sed -n '/^This software is available as a choice of the following licenses/,$p' vendor/miniaudio/miniaudio.h > "$notices/LICENSE-miniaudio"
sed -n '1,/unlicense.org/p' vendor/sheredom/subprocess.h > "$notices/LICENSE-subprocess"
for notice in stb miniaudio subprocess; do test -s "$notices/LICENSE-$notice"; done

%check
server=%{buildroot}%{_libexecdir}/dashi/llama/llama-server
# It starts, and is the build that was measured.
"$server" --version 2>&1 | grep -F "build %{llama_build}, commit %{llama_short}"
# The processor only: no graphics backend was built, and nothing of Vulkan or TLS is linked.
test -z "$(find %{buildroot}%{_libexecdir}/dashi/llama -name 'libggml-vulkan*')"
! ldd "$server" %{buildroot}%{_libexecdir}/dashi/llama/*.so | grep -Ei 'vulkan|libssl|libcrypto|libcurl'
# A processor backend for the oldest x86-64 and for today's.
%ifarch x86_64
test -f %{buildroot}%{_libexecdir}/dashi/llama/libggml-cpu-x64.so
test -f %{buildroot}%{_libexecdir}/dashi/llama/libggml-cpu-haswell.so
%endif

%files
%license %{_datadir}/licenses/%{name}/
%dir %{_libexecdir}/dashi
%{_libexecdir}/dashi/llama/

%changelog
* Sun Nov 15 2026 PejeDev <hi@peje.dev> - 1.0.0~b12359-2
- First build: the processor only (no Vulkan), pinned by commit and checksum, with the notices of what is built in

* Sun Nov 15 2026 PejeDev <hi@peje.dev> - 1.0.0~b12359-1
- llama.cpp's server at build 12359, for the model that corrects dictation (written, never built)
