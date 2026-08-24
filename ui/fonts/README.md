# Fonts

Self-hosted, **not** loaded from the Google Fonts CDN. Three reasons, all
structural rather than preference:

- The Content-Security-Policy in [`auth-design.md`](../../docs/auth-design.md)
  §8.2 sets `font-src 'self'` with no third-party origin. A CDN font would be
  blocked outright.
- They are Workbox-precached, so they are available offline. A CDN never would
  be, and offline is the product.
- Nothing third-party can block, throttle, or observe them — privacy add-ons,
  corporate proxies, and blocked CDNs are all real
  ([`frontend-design.md`](../../docs/frontend-design.md) §6).

## What is here

One **variable** woff2 per family, subsetted to Latin — the `latin` subset as
Google Fonts cuts it (`U+0000-00FF` plus common punctuation and symbols). One
variable file covers each family's whole weight range, which is why this is
three files rather than eight.

| File | Family | Weights | Size |
| --- | --- | --- | --- |
| `bricolage-grotesque-latin.woff2` | Bricolage Grotesque | 600–700 | 75 KB |
| `spline-sans-latin.woff2` | Spline Sans | 400–600 | 56 KB |
| `spline-sans-mono-latin.woff2` | Spline Sans Mono | 400–600 | 36 KB |

Only Spline Sans is `<link rel="preload">`ed — it is the primary UI font and
the only one on the critical path.

## Licence

All three are licensed **SIL Open Font License 1.1**. The licence text, with
all three copyright notices, is in [`OFL.txt`](OFL.txt) and must be
redistributed with the fonts.

## Refreshing them

The files were taken from the Google Fonts CDN's `latin` subset. To update,
request the CSS with a modern browser `User-Agent` (the API serves woff2 only
to browsers it believes support it), take the `src` URL from the block whose
`unicode-range` begins `U+0000-00FF`, and download it:

```
curl -A '<a modern browser UA>' \
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..700&family=Spline+Sans:wght@400..600&family=Spline+Sans+Mono:wght@400..600&display=swap'
```

Check afterwards that the `font-weight` range in the served `@font-face` still
matches the ranges declared in `../styles/index.css`; a family that drops its
variable cut would otherwise render at a silently wrong weight.
