import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { Dispatch } from './Dispatch'
import { Explore } from './Explore'
import { Risk } from './Risk'
import './style.css'
import { WhatIf } from './WhatIf'

/** The pages, by the hash that selects them. Pages serves one file, so the route lives after the `#`. */
const PAGES = {
  '': { title: 'What if', page: WhatIf },
  dispatch: { title: 'Dispatch', page: Dispatch },
  risk: { title: 'Risk', page: Risk },
  explore: { title: 'Explore', page: Explore },
}
type Route = keyof typeof PAGES

const route = (): Route => {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return hash in PAGES ? (hash as Route) : ''
}

function App() {
  const [current, setCurrent] = useState(route)
  useEffect(() => {
    const onChange = () => {
      setCurrent(route())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  useEffect(() => {
    document.title = `${PAGES[current].title} · specsolve-app`
  }, [current])
  const Page = PAGES[current].page
  return (
    <>
      <nav className="top">
        <strong>specsolve-app</strong>
        {(Object.keys(PAGES) as Route[]).map((key) => (
          <a key={key} href={`#/${key}`} aria-current={key === current ? 'page' : undefined}>
            {PAGES[key].title}
          </a>
        ))}
        <span className="muted">
          An example client of <a href="https://github.com/fluxopt/specsolve-showcase">the specsolve showcase</a>'s
          published archives.
        </span>
      </nav>
      <main>
        <Page />
      </main>
      <footer className="muted">
        Built with React, <a href="https://github.com/TanStack/charts">TanStack Charts</a> and{' '}
        <a href="https://github.com/TanStack/table">TanStack Table</a>. The data is parquet read
        over HTTP from the archives the showcase's solve job writes;{' '}
        <a href="https://github.com/fluxopt/specsolve-app">the source</a>.
      </footer>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
