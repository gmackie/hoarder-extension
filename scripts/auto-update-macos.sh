#!/bin/sh

set -eu

install_dir="${HOME}/Applications/Hoarder Extension/current"
repository="gmackie/hoarder-extension"
release_base_url=""
latest_version=""
refresh_script=false
work_dir=""
lock_dir="${TMPDIR:-/tmp}/hoarder-auto-update.lock"

usage() {
  cat <<'EOF'
Usage: auto-update-macos.sh [options]

Options:
  --install-dir DIR          Unpacked extension directory to update.
  --repository OWNER/REPO    GitHub repository used to discover releases.
  --release-base-url URL     Override the release download location.
  --latest-version VERSION   Check a specific version instead of GitHub latest.
EOF
}

cleanup() {
  [ -z "$work_dir" ] || rm -rf "$work_dir"
  rm -f "$lock_dir/pid"
  rmdir "$lock_dir" 2>/dev/null || true
}

acquire_lock() {
  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" > "$lock_dir/pid"
    return
  fi

  existing_pid=""
  if [ -f "$lock_dir/pid" ]; then
    existing_pid=$(sed -n '1p' "$lock_dir/pid")
  fi
  case "$existing_pid" in
    ''|*[!0-9]*) ;;
    *)
      if kill -0 "$existing_pid" 2>/dev/null; then
        echo "Another Hoarder update check is already running"
        exit 0
      fi
      ;;
  esac

  rm -f "$lock_dir/pid"
  if ! rmdir "$lock_dir" 2>/dev/null || ! mkdir "$lock_dir" 2>/dev/null; then
    echo "Could not recover the automatic update lock" >&2
    exit 1
  fi
  printf '%s\n' "$$" > "$lock_dir/pid"
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

json_value() {
  file=$1
  key=$2
  if command -v plutil >/dev/null 2>&1; then
    plutil -extract "$key" raw -o - "$file" 2>/dev/null && return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' \
      "$file" "$key" 2>/dev/null && return 0
  fi
  sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" \
    "$file" | head -n 1
}

valid_version() {
  printf '%s\n' "$1" | grep -Eq '^[0-9]+(\.[0-9]+){1,3}$'
}

version_is_newer() {
  awk -v candidate="$1" -v installed="$2" 'BEGIN {
    split(candidate, a, ".");
    split(installed, b, ".");
    for (i = 1; i <= 4; i++) {
      left = (a[i] == "" ? 0 : a[i]) + 0;
      right = (b[i] == "" ? 0 : b[i]) + 0;
      if (left > right) exit 0;
      if (left < right) exit 1;
    }
    exit 1;
  }'
}

valid_repository() {
  case "$1" in
    ''|/*|*/|*/*/*|*[!A-Za-z0-9._/-]*) return 1 ;;
    */*) return 0 ;;
    *) return 1 ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-dir)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      install_dir=$2
      shift 2
      ;;
    --repository)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      repository=$2
      shift 2
      ;;
    --release-base-url)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      release_base_url=$2
      shift 2
      ;;
    --latest-version)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      latest_version=$2
      shift 2
      ;;
    --refresh-script)
      refresh_script=true
      shift
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

valid_repository "$repository" || {
  echo "Invalid GitHub repository: $repository" >&2
  exit 2
}

[ -f "$install_dir/manifest.json" ] || {
  echo "No installed manifest found in $install_dir" >&2
  exit 1
}

acquire_lock
trap cleanup EXIT HUP INT TERM

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/hoarder-auto-update.XXXXXX")
installed_version=$(json_value "$install_dir/manifest.json" version)
valid_version "$installed_version" || {
  echo "Invalid installed version: $installed_version" >&2
  exit 1
}

if [ -z "$latest_version" ]; then
  latest_json="$work_dir/latest.json"
  curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: hoarder-extension-updater" \
    "https://api.github.com/repos/${repository}/releases/latest" \
    -o "$latest_json"
  latest_version=$(json_value "$latest_json" tag_name)
fi
latest_version=${latest_version#v}
valid_version "$latest_version" || {
  echo "Invalid latest version: $latest_version" >&2
  exit 1
}

if ! version_is_newer "$latest_version" "$installed_version"; then
  echo "Hoarder $installed_version is current"
  exit 0
fi

if [ -z "$release_base_url" ]; then
  release_base_url="https://github.com/${repository}/releases/download"
fi
asset_base="${release_base_url%/}/v${latest_version}"
installer="$work_dir/install-hoarder.sh"
checksum_file="$work_dir/install-hoarder.sh.sha256"
curl -fsSL "$asset_base/install-hoarder.sh" -o "$installer"
curl -fsSL "$asset_base/install-hoarder.sh.sha256" -o "$checksum_file"
expected_sha256=$(awk 'NR == 1 { print $1 }' "$checksum_file" | tr '[:upper:]' '[:lower:]')
printf '%s\n' "$expected_sha256" | grep -Eq '^[0-9a-f]{64}$' || {
  echo "Invalid installer checksum" >&2
  exit 1
}
actual_sha256=$(sha256_file "$installer" | tr '[:upper:]' '[:lower:]')
[ "$actual_sha256" = "$expected_sha256" ] || {
  echo "SHA-256 mismatch for automatic update installer" >&2
  exit 1
}

sh "$installer" \
  --version "$latest_version" \
  --release-base-url "$release_base_url" \
  --install-dir "$install_dir"

if [ "$refresh_script" = true ] && \
   [ -f "$install_dir/scripts/auto-update-macos.sh" ]; then
  script_directory=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
  script_path="$script_directory/$(basename "$0")"
  replacement="${script_path}.new.$$"
  cp "$install_dir/scripts/auto-update-macos.sh" "$replacement"
  chmod 755 "$replacement"
  mv "$replacement" "$script_path"
fi

echo "Updated Hoarder from $installed_version to $latest_version"
