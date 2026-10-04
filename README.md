# Con Healy's website

Personal homepage and Stillroom, an artwork exploration app using the Met's
public collection API.

GitHub Pages publishes this site's public files using `.github/workflows/pages.yml`
on pushes to `master`, manual runs, and scheduled runs roughly every 15 minutes.
The schedule refreshes the BBC RSS snapshot; Wikipedia changes load directly in
the browser, with a saved snapshot as a fallback. GitHub may delay scheduled runs.

The homepage is at `/`, Stillroom at `/explore-met-art/`, and Matrix Feed at
`/matrix-retrofuturistic-doomscroll/`.

Run `node scripts/refresh-feeds.mjs` to update the saved feeds locally.

The previous website is preserved in Git history.
