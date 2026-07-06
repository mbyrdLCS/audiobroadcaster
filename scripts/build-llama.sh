#!/bin/bash
# Builds llama-server (llama.cpp) as a static arm64 macOS binary for offline
# caption translation. Output lands in resources/llama/, bundled by
# electron-builder as extraResources.
#
# arm64 only, Metal with embedded shaders: offline translation is disabled on
# Intel Macs (a 4B LLM on x86 CPU is far too slow for live captions), so no
# x86_64 slice is built. The 2.5 GB Gemma model is NOT bundled — the app
# downloads it on first enable (see main.js).
#
# Run once before `npm run build` (or after bumping LLAMA_VERSION):
#   ./scripts/build-llama.sh
set -euo pipefail

LLAMA_VERSION=b9886

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/llama.cpp"
OUT="$ROOT/resources/llama"

mkdir -p "$OUT"

if [ ! -d "$SRC" ]; then
    git clone --depth 1 --branch "$LLAMA_VERSION" https://github.com/ggml-org/llama.cpp.git "$SRC"
fi

echo "=== Building llama-server (arm64, Metal) ==="
cmake -S "$SRC" -B "$SRC/build-arm64" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_NATIVE=OFF \
    -DGGML_METAL=ON \
    -DGGML_METAL_EMBED_LIBRARY=ON \
    -DLLAMA_CURL=OFF \
    -DLLAMA_SERVER_SSL=OFF \
    -DCMAKE_DISABLE_FIND_PACKAGE_OpenSSL=TRUE \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_SERVER=ON \
    -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0
cmake --build "$SRC/build-arm64" --target llama-server -j "$(sysctl -n hw.ncpu)"

cp "$SRC/build-arm64/bin/llama-server" "$OUT/llama-server"
file "$OUT/llama-server"

echo "=== Done ==="
ls -lh "$OUT"
