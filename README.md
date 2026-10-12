# specsolve-app

An example client of [specsolve](https://github.com/fluxopt/specsolve) archives:
a static React app, with charts by [TanStack Charts](https://github.com/TanStack/charts),
that reads the archives the [specsolve showcase](https://github.com/fluxopt/specsolve-showcase)
publishes, and on one page solves the showcase's model again in the browser.

**Live:** <https://fluxopt.github.io/specsolve-app/>

```text
specsolve-showcase                                      specsolve-app
  showcase-grid ──▶ grid/<point>/ ──▶ Pages: archive/grid/ ──HTTP──▶ hyparquet ──▶ React + TanStack Charts
   (specsolve)       (parquet)          (stacked per path)
```

The showcase's own site is one client of those archives. This app is another,
built with a different stack, to make the point the showcase makes: **the
contract is the archive directory, not a library.** No page that reads an
answer imports specsolve, and nothing here is shared with the showcase except
the URL.

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
  28 KB: one investment period planned against 60 futures at once, at ten
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

## Solving in the tab

**Solve** ([`src/Solve.tsx`](src/Solve.tsx)) asks a scenario's question again.
It reads the scenario's own inputs out of its published archive (`spec.yaml`,
`axis.json` and every `sources/<name>.parquet` its `catalog.parquet` lists),
shows every parameter in a table whose values you can type over or scale a
filtered set of rows at once ([`src/DataEditor.tsx`](src/DataEditor.tsx)),
shows the spec in a code editor ([`src/SpecEditor.tsx`](src/SpecEditor.tsx))
that completes, explains and checks it against mathspec's own schema
([`src/specSchema.ts`](src/specSchema.ts)) as you type and colours each name
in an expression by what the file declares it as
([`src/specHighlight.ts`](src/specHighlight.ts)), with the model as
math beside it ([`src/MathPreview.tsx`](src/MathPreview.tsx)), and
solves the pathway with specsolve and HiGHS in a Web Worker
([`src/solver.worker.ts`](src/solver.worker.ts)). The worker loads
[Pyodide](https://pyodide.org) from its CDN at the version `package.json` pins,
installs specsolve from PyPI, and runs [`src/solve.py`](src/solve.py). The page
puts what comes back beside the published answer.

Pyodide's polars is 1.33.1, the newest polars that builds for the browser, and
it reads and writes no parquet. specsolve 0.9 runs on that polars. So the page
reads the sources with hyparquet and passes them to Python as columns, the
worker passes the archive's `axis.json` to `solve_over` as it is, carry
included, and the answer comes back as columns.

**Solve and download the archive** saves the run as a specsolve archive, a zip
that `sps.load_archive` and DuckDB read. specsolve writes it through pyarrow
where polars has no parquet, so the worker loads pyarrow the first time it is
asked for one, about 15 MB more.

The math is mathspec's `to_markdown` of the spec, run in the worker and
rendered with KaTeX. It needs Python, so it starts after a solve or when asked,
never on a visit alone, and then follows each edit.

The first solve downloads about 38 MB of Python and packages. After two solves
the tab holds about 780 MB, and about 1.1 GB once pyarrow is loaded, so a
desktop browser is fine and a phone may reload the page.

`src/mathspec.schema.json` is mathspec's `schema/mathspec.schema.json` at
`v0.2.1`, the mathspec the worker installs. A specsolve that requires a newer
mathspec takes the schema from that tag.

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
