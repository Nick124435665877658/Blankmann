import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Gibt dem Service Worker bei jedem Build einen neuen Cache-Namen.
// Dadurch ändert sich sw.js mit jedem Deploy: Der Browser installiert den neuen
// Service Worker, und main.tsx lädt die App selbst neu, ohne manuelles Cache-Löschen.
function serviceWorkerBuildId(): Plugin {
  return {
    name: 'blankmann-sw-build-id',
    apply: 'build',
    async writeBundle(options) {
      // Node-Modul dynamisch laden: das Projekt hat keine @types/node.
      const fsModule = 'node:fs/promises'
      const fs = (await import(fsModule)) as {
        readFile: (path: string, encoding: 'utf8') => Promise<string>
        writeFile: (path: string, data: string) => Promise<void>
      }
      const file = (options.dir ?? 'dist') + '/sw.js'
      const source = await fs.readFile(file, 'utf8')
      const pattern = /const CACHE = '[^']*'/
      if (!pattern.test(source)) throw new Error('sw.js: Zeile "const CACHE = \'…\'" nicht gefunden, Cache-Name konnte nicht erneuert werden.')
      const buildId = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
      await fs.writeFile(file, source.replace(pattern, "const CACHE = 'blankmann-shell-" + buildId + "'"))
    },
  }
}

export default defineConfig({ plugins: [react(), serviceWorkerBuildId()] })
