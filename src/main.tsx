import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './style.css'
import { WhatIf } from './WhatIf'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <nav className="top">
      <strong>specsolve-app</strong>
      <span className="muted">
        An example client of{' '}
        <a href="https://github.com/fluxopt/specsolve-showcase">the specsolve showcase</a>'s published archives.
      </span>
    </nav>
    <main>
      <WhatIf />
    </main>
    <footer className="muted">
      Built with React and <a href="https://github.com/TanStack/charts">TanStack Charts</a>. The data is parquet read
      over HTTP from the archives the showcase's solve job writes; <a href="https://github.com/fluxopt/specsolve-app">the source</a>.
    </footer>
  </StrictMode>,
)
