#!/bin/bash
# Run this from the root of your actual repository (where both
# index.html and src/index.html currently sit side by side).
#
# It only reports differences — it does not delete anything. Read the
# output before removing src/.

set -e

echo "=== Comparing js/ (root) against src/js/ ==="
if [ -d "src/js" ]; then
  diff -rq js/ src/js/ --exclude="firebaseConfig.js" || true
else
  echo "src/js/ does not exist — nothing to compare."
fi

echo ""
echo "=== Comparing css/ (root) against src/css/ ==="
if [ -d "src/css" ]; then
  diff -rq css/ src/css/ || true
else
  echo "src/css/ does not exist — nothing to compare."
fi

echo ""
echo "=== Comparing index.html (root) against src/index.html ==="
if [ -f "src/index.html" ]; then
  diff -q index.html src/index.html || true
else
  echo "src/index.html does not exist — nothing to compare."
fi

echo ""
echo "=== Files that exist ONLY under src/js/, not under js/ ==="
if [ -d "src/js" ]; then
  comm -13 <(cd js && find . -type f | sort) <(cd src/js && find . -type f | sort)
fi

echo ""
echo "If the diffs above show NO output (other than the intentionally"
echo "excluded, gitignored firebaseConfig.js), src/ is a pure leftover"
echo "duplicate and it's safe to remove:"
echo ""
echo "    rm -rf src/"
echo ""
echo "If ANY diff shows real differences, do not delete yet — something"
echo "under src/ has content that never made it to root, and needs to"
echo "be reconciled manually first."
