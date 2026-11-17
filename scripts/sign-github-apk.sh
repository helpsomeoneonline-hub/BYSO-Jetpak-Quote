#!/usr/bin/env bash
# Re-sign the installable APK with one permanent, certificate-pinned key.
set -euo pipefail
if (( $# < 1 )); then echo "Usage: bash scripts/sign-github-apk.sh file.apk [more.apk ...]" >&2; exit 2; fi
# Preferred: ONE secret ANDROID_SIGNING_BUNDLE = "v1.<password>.<sha256-fingerprint>.<keystore-base64>"
# (Base64, hex and the alphanumeric password never contain '.', so '.' is a safe separator.)
# The older three separate settings still work if the bundle is not set.
if [[ -n "${ANDROID_SIGNING_BUNDLE:-}" ]]; then
  bundle="$(printf '%s' "$ANDROID_SIGNING_BUNDLE" | tr -d '[:space:]')"
  IFS='.' read -r b_ver b_pw b_fp b_ks <<< "$bundle"
  if [[ "$b_ver" != "v1" || -z "$b_pw" || -z "$b_fp" || -z "$b_ks" ]]; then
    echo "::error::ANDROID_SIGNING_BUNDLE is not in the expected v1.<password>.<fingerprint>.<keystore> format" >&2; exit 1
  fi
  echo "::add-mask::$b_pw"
  export ANDROID_SIGNING_STORE_PASSWORD="$b_pw" ANDROID_SIGNING_CERT_SHA256="$b_fp" ANDROID_SIGNING_KEYSTORE_B64="$b_ks"
  unset b_pw b_ks bundle
fi
for setting in ANDROID_SIGNING_KEYSTORE_B64 ANDROID_SIGNING_STORE_PASSWORD ANDROID_SIGNING_CERT_SHA256; do
  if [[ -z "${!setting:-}" ]]; then
    echo "::error::Missing $setting. Add the ANDROID_SIGNING_BUNDLE secret (see docs/ANDROID_SIGNING.md). Refusing disposable-signed APK." >&2
    exit 1
  fi
done
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
if [[ ! -d "$sdk/build-tools" ]]; then echo "::error::Android SDK build-tools not found" >&2; exit 1; fi
signer="$(find "$sdk/build-tools" -maxdepth 2 -type f -name apksigner | sort -V | tail -n 1)"
if [[ -z "$signer" ]]; then echo "::error::apksigner not found" >&2; exit 1; fi
umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf '%s' "$ANDROID_SIGNING_KEYSTORE_B64" | base64 --decode > "$work/app-signing.jks"
if [[ ! -s "$work/app-signing.jks" ]]; then echo "::error::Invalid signing keystore secret" >&2; exit 1; fi
expected="$(printf '%s' "$ANDROID_SIGNING_CERT_SHA256" | tr -d ':[:space:]' | tr '[:lower:]' '[:upper:]')"
if [[ ! "$expected" =~ ^[0-9A-F]{64}$ ]]; then echo "::error::ANDROID_SIGNING_CERT_SHA256 must be a SHA-256 fingerprint" >&2; exit 1; fi
for apk in "$@"; do
  if [[ ! -s "$apk" ]]; then echo "::error::Missing APK: $apk" >&2; exit 1; fi
  cp "$apk" "$work/original.apk"
  "$signer" sign --ks "$work/app-signing.jks" --ks-key-alias app --ks-pass env:ANDROID_SIGNING_STORE_PASSWORD --key-pass env:ANDROID_SIGNING_STORE_PASSWORD --out "$work/signed.apk" "$work/original.apk"
  fingerprint="$("$signer" verify --print-certs "$work/signed.apk" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -n 1)"
  actual="$(printf '%s' "$fingerprint" | tr -d ':[:space:]' | tr '[:lower:]' '[:upper:]')"
  if [[ "$actual" != "$expected" ]]; then
    echo "::error::APK certificate does not match the pinned fingerprint. Refusing publication: $apk" >&2
    exit 1
  fi
  "$signer" verify --verbose "$work/signed.apk"
  mv -f "$work/signed.apk" "$apk"
  echo "Permanent APK signing certificate verified: $actual ($apk)"
done
