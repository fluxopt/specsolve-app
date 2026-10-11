"""Ask a published sweep's question again, in the browser.

The worker writes this module into Pyodide and calls `solve`. Pyodide's polars
reads and writes no parquet, so the page reads the archive's sources and hands
them over as columns, and the answer comes back as columns rather than as an
archive.
"""

import json
import traceback

import polars as pl
import specsolve as sps
from mathspec import to_spec
from specsolve.axes import axis_from

#: The record columns the page reads, beside the sweep's key.
RECORD = ['termination_condition', 'objective']


def solve(spec: str, sources: dict[str, dict[str, list]], axis: str) -> dict[str, object] | str:
    """Solve *spec* over *sources* once per slice of *axis*, the text of an archive's `axis.json`.

    Returns ``{'key': name, 'record': columns, 'primal': {variable: columns}}``,
    every table as ``{column: values}``, or, where the spec, the data or the
    solve is refused, the exception as Python prints it.
    """
    try:
        declared = to_spec(spec)
        manifest = json.loads(axis)
        tables = {name: pl.DataFrame(columns, strict=False) for name, columns in sources.items()}
        sweep = sps.solve_over(declared, tables, axis_from(manifest), carry=manifest.get('carry', {}))
    except Exception as refused:  # noqa: BLE001 — the page shows any refusal to the person who edited the spec
        return ''.join(traceback.format_exception_only(refused)).strip()
    return {
        'key': sweep.key_name,
        'record': sweep.record.select(sweep.key_name, *RECORD).to_dict(as_series=False),
        'primal': {name: sweep.primal(name).to_dict(as_series=False) for name in declared.variables},
    }
