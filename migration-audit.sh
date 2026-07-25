#!/bin/bash
# Run this from the root of your ACTUAL repository — the one place
# both index.html and src/index.html currently exist side by side.
# This script is read-only: it produces a report and deletes NOTHING.
# Follow the recommendation at the end only after reading the report.

set -e
cd "$(dirname "$0")" 2>/dev/null || true

if [ ! -d "src" ]; then
  echo "No src/ directory found here. Either this isn't the right"
  echo "repository root, or the duplicate has already been resolved."
  exit 0
fi

echo "======================================================================"
echo "MIGRATION AUDIT REPORT"
echo "======================================================================"
echo ""

echo "--- 1. Files that exist ONLY in /src (not present at root) ---"
echo ""
for dir in js css data; do
  if [ -d "src/$dir" ]; then
    echo "  Under src/$dir/:"
    comm -13 \
      <(cd "$dir" 2>/dev/null && find . -type f | sort || echo "") \
      <(cd "src/$dir" && find . -type f | sort) \
      | sed 's/^/    /'
  fi
done
if [ -f "src/index.html" ] && [ ! -f "index.html" ]; then
  echo "  src/index.html (no root index.html exists at all)"
fi
echo ""

echo "--- 2. Files that exist ONLY at root (not present in /src) ---"
echo ""
for dir in js css data; do
  if [ -d "$dir" ]; then
    echo "  Under $dir/:"
    comm -23 \
      <(cd "$dir" && find . -type f | sort) \
      <(cd "src/$dir" 2>/dev/null && find . -type f | sort || echo "") \
      | sed 's/^/    /'
  fi
done
echo ""

echo "--- 3. Files present in BOTH locations but with different content ---"
echo ""
for dir in js css data; do
  if [ -d "$dir" ] && [ -d "src/$dir" ]; then
    echo "  Under $dir/ vs src/$dir/:"
    diff -rq "$dir" "src/$dir" 2>/dev/null | grep "differ" | sed 's/^/    /' || echo "    (none differ)"
  fi
done
if [ -f "index.html" ] && [ -f "src/index.html" ]; then
  echo "  index.html vs src/index.html:"
  if diff -q index.html src/index.html > /dev/null 2>&1; then
    echo "    identical"
  else
    echo "    DIFFER — see: diff index.html src/index.html"
  fi
fi
echo ""

echo "--- 4. Recommendation ---"
echo ""
ONLY_IN_SRC=$( { for dir in js css data; do
  comm -13 <(cd "$dir" 2>/dev/null && find . -type f | sort || echo "") <(cd "src/$dir" 2>/dev/null && find . -type f | sort || echo "")
done | grep -c . ; } || true )
ONLY_IN_SRC=${ONLY_IN_SRC:-0}

if [ "$ONLY_IN_SRC" -eq "0" ]; then
  echo "  Nothing under src/ is missing from root. Root is the complete,"
  echo "  self-contained application. src/ is a pure leftover duplicate."
  echo ""
  echo "  Safe to remove once you've also visually confirmed section 3"
  echo "  above shows no unexpected content differences:"
  echo ""
  echo "      rm -rf src/"
else
  echo "  $ONLY_IN_SRC file(s) exist ONLY under src/ and were never"
  echo "  copied to root — see section 1 above. DO NOT DELETE src/ yet."
  echo "  Move those specific files to their root equivalent first, then"
  echo "  re-run this script to confirm before removing src/."
fi
echo ""
echo "======================================================================"
