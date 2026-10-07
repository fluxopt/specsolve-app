import { type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * Render `children` only while they are near the viewport, and keep their last rendering while they are not.
 *
 * A chart far off screen then costs nothing when the page's selection moves,
 * and catches up when it scrolls back into view. Before it is first seen it
 * holds its `height`, so the page does not jump when it appears.
 */
export function Visible({ height, children }: { height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [shown, setShown] = useState<ReactNode>(null)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '300px 0px' })
    observer.observe(ref.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (near) setShown(children)
  }, [near, children])
  return (
    <div ref={ref} style={{ minHeight: height }}>
      {near ? children : shown}
    </div>
  )
}
