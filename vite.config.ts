import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative asset paths, so the build serves from GitHub Pages' /specsolve-app/ as it does from a local preview.
// Pyodide loads its own files at runtime, which Vite's dependency pre-bundling would break, and the solver worker is an ES module.
export default defineConfig({ base: './', plugins: [react()], optimizeDeps: { exclude: ['pyodide'] }, worker: { format: 'es' } })
