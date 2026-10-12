import { useEffect, useMemo, useState } from 'react'

import { typeset } from './solver'

type Shown = { state: 'waiting' } | { state: 'loading'; stage: string } | { state: 'shown'; html: string; refused: string | null }

/**
 * The spec as mathspec typesets it, beside the editor. The renderer, KaTeX among it, loads with the first typeset.
 *
 * Typesetting runs in the worker's Python, so the preview waits for Python rather than loading it on a visit: it
 * starts once *pythonReady* says a solve has loaded it, or when the button asks. It then follows *spec*, half a second
 * after the last edit. A spec mathspec refuses keeps the last math it typeset, dimmed, under the refusal.
 */
export function MathPreview({ spec, pythonReady, onPythonReady }: { spec: string; pythonReady: boolean; onPythonReady: () => void }) {
  const [shown, setShown] = useState<Shown>({ state: 'waiting' })
  const [asked, setAsked] = useState(false)
  const live = pythonReady || asked

  useEffect(() => {
    if (!live) return
    let current = true
    const timer = window.setTimeout(() => {
      Promise.all([typeset(spec, (stage) => current && setShown({ state: 'loading', stage })), import('./renderMath')]).then(
        ([result, { renderMath }]) => {
          if (!current) return
          onPythonReady()
          setShown((before) =>
            'markdown' in result
              ? { state: 'shown', html: renderMath(result.markdown), refused: null }
              : { state: 'shown', html: before.state === 'shown' ? before.html : '', refused: result.refused },
          )
        },
        (e: unknown) => current && setShown({ state: 'shown', html: '', refused: e instanceof Error ? e.message : String(e) }),
      )
    }, 500)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [spec, live, onPythonReady])

  const body = useMemo(() => (shown.state === 'shown' ? { __html: shown.html } : undefined), [shown])

  return (
    <div className="math-preview" aria-label="The model as math" aria-live="polite">
      {shown.state === 'waiting' && !live && (
        <div className="math-waiting">
          <p className="muted">The model as math appears here once Python has loaded: solve once, or load it now.</p>
          <button className="link" onClick={() => setAsked(true)}>
            Show the math
          </button>
        </div>
      )}
      {(shown.state === 'loading' || (shown.state === 'waiting' && live)) && (
        <p className="muted">{shown.state === 'loading' ? `${shown.stage}…` : 'Typesetting…'}</p>
      )}
      {shown.state === 'shown' && shown.refused && <pre className="math-refused">{shown.refused}</pre>}
      {body && <div className={shown.state === 'shown' && shown.refused ? 'math stale' : 'math'} dangerouslySetInnerHTML={body} />}
    </div>
  )
}
