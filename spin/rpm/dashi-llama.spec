# dashi-llama: llama.cpp's server, the separate program that runs the small
# model which corrects dictation (docs/dictation-rewrite.md). MIT. Dashi only
# starts it and talks to it over a Unix socket; nothing of it is linked into
# Dashi.
#
# Why not Fedora's own llama-cpp: Fedora 44 has build 6153, which is older
# than the models Dashi uses, is built for ROCm (it pulls hipblas) and has no
# Vulkan backend, the one that reaches an integrated GPU. This package builds
# a pinned release with Vulkan and the processor backends, and installs only
# the server, under Dashi's own libexec folder, so it never clashes with
# Fedora's package.
#
# The model is never in the package: dashi-voice fetches it when the person
# asks for it in Settings › Voice.
#
# Not built yet: written from llama.cpp's build documentation and the layout
# of its release b12359, which is what the measurements ran on
# (dashi-0.9.0-review/24-rewrite). The first build must check the file list.
%global debug_package %{nil}
%global llama_build b12359

Name:           dashi-llama
Version:        1.0.0~%{llama_build}
Release:        1%{?dist}
Summary:        llama.cpp's server, for the model that corrects Dashi's dictation
License:        MIT
URL:            https://github.com/ggml-org/llama.cpp
Source0:        https://github.com/ggml-org/llama.cpp/archive/refs/tags/%{llama_build}.tar.gz#/llama.cpp-%{llama_build}.tar.gz
ExclusiveArch:  x86_64 aarch64

BuildRequires:  cmake
BuildRequires:  gcc-c++
BuildRequires:  ninja-build
# The Vulkan backend: headers, the loader, and the shader compiler its build runs.
BuildRequires:  vulkan-headers
BuildRequires:  vulkan-loader-devel
BuildRequires:  glslc
BuildRequires:  spirv-headers-devel

# Loaded at run time when a graphics card is used; without one the server runs on the processor.
Recommends:     vulkan-loader
Recommends:     mesa-vulkan-drivers

%description
llama.cpp's llama-server, built with the Vulkan backend and a processor
backend for each x86-64 level, installed where only Dashi looks for it
(/usr/libexec/dashi/llama). Dashi starts it as a unit of your session when
you dictate, on a Unix socket only you can open, with no network, and stops
it after ten idle minutes.

%prep
%autosetup -n llama.cpp-%{llama_build}

%build
# Nothing is fetched while it builds (no curl, no web UI download), and the
# processor backend is picked at run time, never the builder's own CPU.
cmake -S . -B build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_RPATH='$ORIGIN' \
  -DBUILD_SHARED_LIBS=ON \
  -DGGML_NATIVE=OFF \
  -DGGML_BACKEND_DL=ON \
  -DGGML_CPU_ALL_VARIANTS=ON \
  -DGGML_VULKAN=ON \
  -DLLAMA_CURL=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_TOOLS=ON \
  -DLLAMA_BUILD_SERVER=ON
cmake --build build --target llama-server

%install
install -d %{buildroot}%{_libexecdir}/dashi/llama
install -m0755 build/bin/llama-server %{buildroot}%{_libexecdir}/dashi/llama/
# The libraries the server loads, beside it (its rpath is $ORIGIN).
find build/bin -maxdepth 1 \( -name 'libllama*.so*' -o -name 'libggml*.so*' -o -name 'libmtmd*.so*' \) \
  -exec cp -a {} %{buildroot}%{_libexecdir}/dashi/llama/ \;

%check
# It starts, and names its build.
LD_LIBRARY_PATH=%{buildroot}%{_libexecdir}/dashi/llama %{buildroot}%{_libexecdir}/dashi/llama/llama-server --version

%files
%license LICENSE
%dir %{_libexecdir}/dashi
%{_libexecdir}/dashi/llama/

%changelog
* Sun Nov 15 2026 PejeDev <hi@peje.dev> - 1.0.0~b12359-1
- llama.cpp's server at build 12359, with Vulkan, for the model that corrects dictation
