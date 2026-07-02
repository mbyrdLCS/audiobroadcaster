#!/bin/bash
# Builds whisper-server as a universal (arm64 + x86_64) macOS binary and
# downloads the Whisper + VAD models. Output lands in resources/whisper/,
# which electron-builder bundles as extraResources.
#
# Run once before `npm run build` (or after bumping WHISPER_VERSION):
#   ./scripts/build-whisper.sh
#
# arm64 slice: Metal GPU acceleration, shaders embedded in the binary.
# x86_64 slice: CPU-only with AVX but not AVX2, so 2011+ Intel Macs work.
#
# Deployment target is 10.15, not 10.13 — whisper.cpp uses std::filesystem,
# which Apple's SDK marks unavailable before Catalina. The app's
# minimumSystemVersion in package.json must stay >= 10.15 to match.
set -euo pipefail

WHISPER_VERSION=v1.9.1
WHISPER_MODEL=base.en
VAD_MODEL=silero-v5.1.2

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/whisper.cpp"
OUT="$ROOT/resources/whisper"

mkdir -p "$OUT"

if [ ! -d "$SRC" ]; then
    git clone --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp.git "$SRC"
fi

COMMON_FLAGS=(
    -DCMAKE_BUILD_TYPE=Release
    -DBUILD_SHARED_LIBS=OFF
    -DGGML_NATIVE=OFF
    -DWHISPER_BUILD_TESTS=OFF
    -DWHISPER_BUILD_EXAMPLES=ON
    -DCMAKE_OSX_DEPLOYMENT_TARGET=10.15
)

echo "=== Building arm64 slice (Metal) ==="
cmake -S "$SRC" -B "$SRC/build-arm64" "${COMMON_FLAGS[@]}" \
    -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DGGML_METAL=ON \
    -DGGML_METAL_EMBED_LIBRARY=ON
cmake --build "$SRC/build-arm64" --target whisper-server -j "$(sysctl -n hw.ncpu)"

echo "=== Building x86_64 slice (CPU, AVX) ==="
cmake -S "$SRC" -B "$SRC/build-x64" "${COMMON_FLAGS[@]}" \
    -DCMAKE_OSX_ARCHITECTURES=x86_64 \
    -DGGML_METAL=OFF \
    -DGGML_AVX=ON \
    -DGGML_AVX2=OFF \
    -DGGML_FMA=OFF \
    -DGGML_F16C=OFF
cmake --build "$SRC/build-x64" --target whisper-server -j "$(sysctl -n hw.ncpu)"

echo "=== Creating universal binary ==="
lipo -create \
    "$SRC/build-arm64/bin/whisper-server" \
    "$SRC/build-x64/bin/whisper-server" \
    -output "$OUT/whisper-server"
lipo -info "$OUT/whisper-server"

echo "=== Downloading models ==="
if [ ! -f "$OUT/ggml-$WHISPER_MODEL.bin" ]; then
    bash "$SRC/models/download-ggml-model.sh" "$WHISPER_MODEL" "$OUT"
fi
if [ ! -f "$OUT/ggml-$VAD_MODEL.bin" ]; then
    bash "$SRC/models/download-vad-model.sh" "$VAD_MODEL" "$OUT"
fi

echo "=== Done ==="
ls -lh "$OUT"
