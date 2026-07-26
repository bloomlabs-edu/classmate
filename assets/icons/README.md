# Icons

ClassMate's app icon — the finalized "CM" monogram, with C in the
Teacher blue and M in the Student orange already used throughout the
rest of the app, on a white rounded square.

- `classmate-icon.svg` — the master, scalable source. Used directly as
  the modern browser favicon (`<link rel="icon" type="image/svg+xml">`
  in `index.html`).
- `favicon-32.png` — 32x32 PNG fallback for browsers without SVG
  favicon support.
- `apple-touch-icon.png` — 180x180, used by iOS "Add to Home Screen."
- `icon-192.png`, `icon-512.png` — standard PWA manifest icon sizes,
  generated ahead of time so they're ready whenever a manifest.json is
  actually built — no manifest exists yet, this is just the icon
  asset itself.

All PNGs are rendered directly from the master SVG, not drawn
separately, so any future color or proportion change only needs to
happen in one file.
