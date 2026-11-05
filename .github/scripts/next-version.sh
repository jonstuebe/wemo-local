#!/usr/bin/env bash
# Work out the next semver release from Conventional Commits since the last
# `v*` tag, and write release notes.
#
#   next-version.sh [notes-file]
#
# Prints `version=X.Y.Z` and `release=true|false` (append to $GITHUB_OUTPUT).
# feat -> minor, fix/perf -> patch, breaking (`!` or BREAKING CHANGE) -> major,
# except below 1.0.0 where breaking changes bump the minor version. With no
# tag yet, the first release is 0.1.0.
set -euo pipefail

notes_file="${1:-/dev/null}"
last_tag="$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null || true)"

if [[ -z "$last_tag" ]]; then
  echo "Initial release." > "$notes_file"
  echo "version=0.1.0"
  echo "release=true"
  exit 0
fi

IFS=. read -r major minor patch <<< "${last_tag#v}"
repo_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}"

bump=none
breaking=() features=() fixes=()
while read -r sha; do
  [[ -z "$sha" ]] && continue
  subject="$(git log -1 --format=%s "$sha")"
  body="$(git log -1 --format=%b "$sha")"
  line="- ${subject} ([${sha:0:7}](${repo_url}/commit/${sha}))"
  if [[ "$subject" =~ ^[a-z]+(\([^\)]*\))?!: ]] || grep -qE '^BREAKING[ -]CHANGE:' <<< "$body"; then
    bump=major; breaking+=("$line")
  elif [[ "$subject" =~ ^feat(\([^\)]*\))?: ]]; then
    [[ "$bump" == major ]] || bump=minor; features+=("$line")
  elif [[ "$subject" =~ ^(fix|perf)(\([^\)]*\))?: ]]; then
    [[ "$bump" == none ]] && bump=patch; fixes+=("$line")
  fi
done < <(git rev-list --no-merges "${last_tag}..HEAD")

# Below 1.0.0, a breaking change only bumps the minor version.
[[ "$bump" == major && "$major" == 0 ]] && bump=minor

case "$bump" in
  major) version="$((major + 1)).0.0" ;;
  minor) version="${major}.$((minor + 1)).0" ;;
  patch) version="${major}.${minor}.$((patch + 1))" ;;
  none)
    : > "$notes_file"
    echo "version=${major}.${minor}.${patch}"
    echo "release=false"
    exit 0 ;;
esac

{
  section() { local title="$1"; shift; (($#)) && printf '## %s\n\n%s\n\n' "$title" "$(printf '%s\n' "$@")"; return 0; }
  section "Breaking changes" ${breaking[@]+"${breaking[@]}"}
  section "Features" ${features[@]+"${features[@]}"}
  section "Fixes" ${fixes[@]+"${fixes[@]}"}
  echo "**Image:** \`docker pull jonstuebe/wemo-local:${version}\`"
  echo
  echo "**Full changelog:** ${repo_url}/compare/${last_tag}...v${version}"
} > "$notes_file"

echo "version=${version}"
echo "release=true"
