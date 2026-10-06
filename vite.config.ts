import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative asset paths, so the build serves from GitHub Pages' /specsolve-app/ as it does from a local preview.
export default defineConfig({ base: './', plugins: [react()] })
