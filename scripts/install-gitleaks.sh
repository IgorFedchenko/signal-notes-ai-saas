#!/bin/sh
set -eu
# Official OSS release, pinned archive SHA-256. No marketplace license or paid API.
archive="${RUNNER_TEMP:-/tmp}/gitleaks_8.30.1_linux_x64.tar.gz"
curl --fail --silent --show-error --location https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz --output "$archive"
echo "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  $archive" | sha256sum --check --status
mkdir -p "${RUNNER_TEMP:-/tmp}/signal-notes-tools"
tar -xzf "$archive" -C "${RUNNER_TEMP:-/tmp}/signal-notes-tools" gitleaks
printf '%s\n' "${RUNNER_TEMP:-/tmp}/signal-notes-tools" >> "$GITHUB_PATH"
