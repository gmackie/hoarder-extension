#!/bin/sh

set -eu

source_dir=""
archive_file=""
expected_sha256=""
release_version=""
release_base_url="https://github.com/gmackie/hoarder-extension/releases/download"
config_file=""
install_dir="${HOME}/Library/Application Support/Hoarder Extension/current"
work_dir=""
stage_dir=""
backup_dir=""

usage() {
  cat <<'EOF'
Usage:
  scripts/install-macos.sh --source-dir DIR [--config FILE] [--install-dir DIR]
  scripts/install-macos.sh --archive FILE --sha256 HASH [--config FILE] [--install-dir DIR]
  scripts/install-macos.sh --version VERSION [--sha256 HASH] [options]

Options:
  --sha256 HASH             Override the checksum published with a release.
  --release-base-url URL  Override the release download location for a fork or mirror.
EOF
}

cleanup() {
  [ -z "$stage_dir" ] || rm -rf "$stage_dir"
  [ -z "$work_dir" ] || rm -rf "$work_dir"
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source-dir)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      source_dir=$2
      shift 2
      ;;
    --archive)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      archive_file=$2
      shift 2
      ;;
    --sha256)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      expected_sha256=$2
      shift 2
      ;;
    --version)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      release_version=$2
      shift 2
      ;;
    --release-base-url)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      release_base_url=$2
      shift 2
      ;;
    --install-dir)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      install_dir=$2
      shift 2
      ;;
    --config)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      config_file=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[ -z "$source_dir" ] || { [ -z "$archive_file" ] && [ -z "$release_version" ]; } || {
  echo "Choose only one of --source-dir, --archive, or --version" >&2
  exit 2
}
[ -z "$archive_file" ] || [ -z "$release_version" ] || {
  echo "Choose only one of --source-dir, --archive, or --version" >&2
  exit 2
}

trap cleanup EXIT HUP INT TERM

if [ -n "$release_version" ]; then
  case "$release_version" in
    *[!0-9A-Za-z._-]*) echo "Invalid release version: $release_version" >&2; exit 2 ;;
  esac
  work_dir=$(mktemp -d "${TMPDIR:-/tmp}/hoarder-install.XXXXXX")
  archive_file="$work_dir/hoarder-extension-v${release_version}.zip"
  release_url="${release_base_url%/}/v${release_version}/hoarder-extension-v${release_version}.zip"
  echo "Downloading $release_url"
  curl -fsSL "$release_url" -o "$archive_file"
  if [ -z "$expected_sha256" ]; then
    checksum_file="$work_dir/hoarder-extension-v${release_version}.zip.sha256"
    curl -fsSL "${release_url}.sha256" -o "$checksum_file"
    expected_sha256=$(awk 'NR == 1 { print $1 }' "$checksum_file")
  fi
fi

if [ -n "$archive_file" ]; then
  [ -f "$archive_file" ] || { echo "Archive not found: $archive_file" >&2; exit 1; }
  [ -n "$expected_sha256" ] || { echo "--sha256 is required with --archive" >&2; exit 2; }
  expected_sha256=$(printf '%s' "$expected_sha256" | tr '[:upper:]' '[:lower:]')
  printf '%s\n' "$expected_sha256" | grep -Eq '^[0-9a-f]{64}$' || {
    echo "Invalid SHA-256: $expected_sha256" >&2
    exit 2
  }
  actual_sha256=$(sha256_file "$archive_file" | tr '[:upper:]' '[:lower:]')
  [ "$actual_sha256" = "$expected_sha256" ] || {
    echo "SHA-256 mismatch for $archive_file" >&2
    exit 1
  }
  if [ -z "$work_dir" ]; then
    work_dir=$(mktemp -d "${TMPDIR:-/tmp}/hoarder-install.XXXXXX")
  fi
  extract_dir="$work_dir/extracted"
  mkdir -p "$extract_dir"
  unzip -q "$archive_file" -d "$extract_dir"
  source_dir="$extract_dir/brave"
fi

[ -n "$source_dir" ] || { usage >&2; exit 2; }
[ -f "$source_dir/manifest.json" ] || {
  echo "No manifest.json found in $source_dir" >&2
  exit 1
}
[ -z "$config_file" ] || [ -f "$config_file" ] || {
  echo "Configuration file not found: $config_file" >&2
  exit 1
}

parent_dir=$(dirname "$install_dir")
stage_dir="${install_dir}.staging.$$"
mkdir -p "$parent_dir" "$stage_dir"
cp -R "$source_dir"/. "$stage_dir"/
if [ -f "$install_dir/local-config.json" ] && [ ! -f "$stage_dir/local-config.json" ]; then
  cp "$install_dir/local-config.json" "$stage_dir/local-config.json"
fi
if [ -n "$config_file" ]; then
  cp "$config_file" "$stage_dir/local-config.json"
fi
if [ -e "$install_dir" ]; then
  backup_dir="${install_dir}.previous.$$"
  mv "$install_dir" "$backup_dir"
fi
if ! mv "$stage_dir" "$install_dir"; then
  [ -z "$backup_dir" ] || mv "$backup_dir" "$install_dir"
  echo "Could not activate the staged extension" >&2
  exit 1
fi
stage_dir=""
[ -z "$backup_dir" ] || rm -rf "$backup_dir"
backup_dir=""
cleanup
work_dir=""
trap - EXIT HUP INT TERM

echo "Hoarder is staged at: $install_dir"
echo "Open brave://extensions, enable Developer mode, and choose Load unpacked."
