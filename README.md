# specsolve-app

An example client of [specsolve](https://github.com/fluxopt/specsolve) archives:
a static React app, with charts by [TanStack Charts](https://github.com/TanStack/charts),
that reads the archives the [specsolve showcase](https://github.com/fluxopt/specsolve-showcase)
publishes and solves nothing itself.

**Live:** <https://fluxopt.github.io/specsolve-app/>

```text
specsolve-showcase                                      specsolve-app
  showcase-grid ──▶ grid/<point>/ ──▶ Pages: archive/grid/ ──HTTP──▶ hyparquet ──▶ React + TanStack Charts
   (specsolve)       (parquet)          (stacked per path)
```

The showcase's own site is one client of those archives. This app is another,
built with a different stack, to make the point the showcase makes: **the
contract is the archive directory, not a library.** Nothing here imports
specsolve, and nothing here is shared with the showcase except the URL.

## What it reads

The showcase's deploy publishes every directory of archives at
`https://fluxopt.github.io/specsolve-showcase/archive/<directory>/`. Beside the
archives it writes each path stacked across them, because a static host cannot
answer a glob: `archive/grid/answer/primal/total.parquet` is
`read_parquet('grid/*/answer/primal/total.parquet')`. Every row names its
archive in `specsolve_run`.

The **What if** page reads seven of those files, about 23 KB, with
[hyparquet](https://github.com/hyparam/hyparquet), and joins them in
[`src/grid.ts`](src/grid.ts). Every chart updates in place and animates from
the old point to the new one when a slider moves; selecting a heatmap cell
moves the sliders.

## Run it

Requires Node 22. Against the published archives:

```bash
npm ci
npm run dev
```

Against archives you solved yourself, from a checkout of the showcase beside this one:

```bash
cd ../specsolve-showcase
uv run showcase-grid --runs grid
uv run python -m tools.publish_archive ../specsolve-app/public/archive grid
cd ../specsolve-app
VITE_ARCHIVE=./archive npm run dev
```

`npm run build` type-checks and builds to `dist/`. A push to `main` publishes
it to GitHub Pages.
