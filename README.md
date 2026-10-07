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

Four pages, each reading a handful of stacked files with
[hyparquet](https://github.com/hyparam/hyparquet) and joining them in
TypeScript:

- **What if** ([`src/grid.ts`](src/grid.ts)) reads seven files of the what-if
  grid, about 23 KB. Every chart updates in place and animates from the old
  point to the new one when a slider moves; selecting a heatmap cell moves
  the sliders.
- **Dispatch** ([`src/dispatch.ts`](src/dispatch.ts)) reads five files of the
  four scenarios: hourly output, the balance constraint's dual, the load, the
  day weights and the emission rates. It plays the pathway period by period,
  morphing the stacked output from one fleet to the next, and one shared
  cursor ties the hour axis of the output and price charts to the
  price-duration curve beside them.
- **Risk** ([`src/hedge.ts`](src/hedge.ts)) reads ten files of the hedge, about
  30 KB: one investment period planned against 60 futures at once, at ten
  weights on the worst tenth of them, beside the plan made for the average
  future and the plans made with perfect foresight. It draws what each plan
  builds, the trade between expected cost and the cost in the worst futures,
  what every future costs, and the weight the plan puts on each, read off the
  duals of the tail rows. Each plan's hours come from that plan's own archive,
  about 70 KB, read when the plan is first shown, because the stacked file of
  every plan's hours holds over a million rows. The tail is computed from each
  future's cost rather than read off the model's `cvar`, which is arbitrary at
  a weight of zero.
- **Explore** ([`src/explore.ts`](src/explore.ts)) knows nothing about the
  model. It reads the stacked `catalog.parquet` of either directory, lists
  every quantity, and opens any of them in a
  [TanStack Table](https://github.com/TanStack/table) to filter, sort and
  group, with the URL of the file it read and the one line that reads it
  from DuckDB or polars.

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
uv run showcase-hedge --runs hedge
uv run python -m tools.publish_archive ../specsolve-app/public/archive grid hedge
cd ../specsolve-app
VITE_ARCHIVE=./archive npm run dev
```

`npm run build` type-checks and builds to `dist/`. A push to `main` publishes
it to GitHub Pages.
