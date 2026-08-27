#!/bin/sh

set -eu

source_dir=""
archive_file=""
expected_sha256=""
release_version=""
repository="gmackie/hoarder-extension"
release_base_url=""
config_file=""
install_dir="${HOME}/Library/Application Support/Hoarder Extension/current"
enable_auto_update=false
disable_auto_update=false
update_interval_hours=6
updater_dir="${HOME}/Library/Application Support/Hoarder Extension/updater"
launch_agents_dir="${HOME}/Library/LaunchAgents"
start_updater=true
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
  --release-base-url URL    Override release downloads for a fork or mirror.
  --enable-auto-update      Install a per-user automatic update agent.
  --disable-auto-update     Unload and remove the automatic update agent.
  --repository OWNER/REPO   GitHub repository used to discover new releases.
  --update-interval-hours N Check for updates every N hours (default: 6).
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

xml_escape() {
  printf '%s' "$1" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\&apos;/g"
}

valid_repository() {
  case "$1" in
    ''|/*|*/|*/*/*|*[!A-Za-z0-9._/-]*) return 1 ;;
    */*) return 0 ;;
    *) return 1 ;;
  esac
}

is_macos_privacy_protected_path() {
  normalized_path="${1%/}/"
  case "$normalized_path" in
    "${HOME%/}/Desktop/"*|"${HOME%/}/Documents/"*|"${HOME%/}/Downloads/"*)
      return 0
      ;;
    *) return 1 ;;
  esac
}

install_auto_updater() {
  updater_source="$install_dir/scripts/auto-update-macos.sh"
  [ -f "$updater_source" ] || {
    echo "Automatic updater is missing from the extension package" >&2
    exit 1
  }

  mkdir -p "$updater_dir" "$launch_agents_dir"
  updater_script="$updater_dir/auto-update-macos.sh"
  cp "$updater_source" "$updater_script"
  chmod 755 "$updater_script"

  label="com.hoarder-extension.auto-update"
  plist="$launch_agents_dir/${label}.plist"
  plist_stage="${plist}.staging.$$"
  interval_seconds=$((update_interval_hours * 3600))
  escaped_updater=$(xml_escape "$updater_script")
  escaped_install=$(xml_escape "$install_dir")
  escaped_repository=$(xml_escape "$repository")
  escaped_release_base=$(xml_escape "$release_base_url")
  escaped_log=$(xml_escape "$updater_dir/auto-update.log")
  cat > "$plist_stage" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$escaped_updater</string>
    <string>--install-dir</string>
    <string>$escaped_install</string>
    <string>--repository</string>
    <string>$escaped_repository</string>
    <string>--release-base-url</string>
    <string>$escaped_release_base</string>
    <string>--refresh-script</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>$interval_seconds</integer>
  <key>StandardOutPath</key>
  <string>$escaped_log</string>
  <key>StandardErrorPath</key>
  <string>$escaped_log</string>
</dict>
</plist>
EOF
  chmod 644 "$plist_stage"
  mv "$plist_stage" "$plist"

  if [ "$start_updater" = true ]; then
    command -v launchctl >/dev/null 2>&1 || {
      echo "launchctl is required to enable automatic updates" >&2
      exit 1
    }
    launch_domain="gui/$(id -u)"
    launchctl bootout "$launch_domain" "$plist" >/dev/null 2>&1 || true
    launchctl bootstrap "$launch_domain" "$plist"
  fi
  echo "Automatic updates enabled every $update_interval_hours hour(s)."
}

disable_auto_updater() {
  label="com.hoarder-extension.auto-update"
  plist="$launch_agents_dir/${label}.plist"
  if [ "$start_updater" = true ] && command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
  fi
  rm -f "$plist" "$updater_dir/auto-update-macos.sh"
  echo "Automatic updates disabled."
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
    --enable-auto-update)
      enable_auto_update=true
      shift
      ;;
    --disable-auto-update)
      disable_auto_update=true
      shift
      ;;
    --repository)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      repository=$2
      shift 2
      ;;
    --update-interval-hours)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      update_interval_hours=$2
      shift 2
      ;;
    --updater-dir)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      updater_dir=$2
      shift 2
      ;;
    --launch-agents-dir)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      launch_agents_dir=$2
      shift 2
      ;;
    --no-start-updater)
      start_updater=false
      shift
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

valid_repository "$repository" || {
  echo "Invalid GitHub repository: $repository" >&2
  exit 2
}
printf '%s\n' "$update_interval_hours" | grep -Eq '^[0-9]+$' || {
  echo "Invalid update interval: $update_interval_hours" >&2
  exit 2
}
[ "$update_interval_hours" -ge 1 ] && [ "$update_interval_hours" -le 168 ] || {
  echo "Update interval must be between 1 and 168 hours" >&2
  exit 2
}
if [ -z "$release_base_url" ]; then
  release_base_url="https://github.com/${repository}/releases/download"
fi
[ "$enable_auto_update" = false ] || [ "$disable_auto_update" = false ] || {
  echo "Choose only one of --enable-auto-update or --disable-auto-update" >&2
  exit 2
}
if [ "$disable_auto_update" = true ]; then
  disable_auto_updater
  exit 0
fi
if [ "$enable_auto_update" = true ] && \
   is_macos_privacy_protected_path "$install_dir"; then
  echo "Automatic updates require an install directory outside Desktop, Documents, or Downloads" >&2
  exit 2
fi

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
[ "$enable_auto_update" = false ] || [ -f "$source_dir/scripts/auto-update-macos.sh" ] || {
  echo "Automatic updater is missing from the extension package" >&2
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
if [ "$enable_auto_update" = true ]; then
  install_auto_updater
fi
