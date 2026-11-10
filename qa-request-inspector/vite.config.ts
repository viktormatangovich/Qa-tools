import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'path'

/**
 * Ships axe-core as extension files of their own. They are not part of the panel bundle: the side
 * panel injects them into the inspected page only when the full accessibility audit runs
 * (see hooks/useQaAnalysis.ts and public/content.js).
 */
function axeCoreAssets(): Plugin {
  const axeDir = resolve(__dirname, 'node_modules/axe-core')
  return {
    name: 'reqpane-axe-core-assets',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'axe.min.js', source: readFileSync(resolve(axeDir, 'axe.min.js'), 'utf8') })
      const locale = JSON.stringify(JSON.parse(readFileSync(resolve(axeDir, 'locales/ru.json'), 'utf8')))
      this.emitFile({ type: 'asset', fileName: 'axe-locale-ru.js', source: `globalThis.__reqpaneAxeLocaleRu = ${locale};\n` })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), axeCoreAssets()],
  build: {
    outDir: 'dist',
    rolldownOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
    copyPublicDir: true,
  },
})
