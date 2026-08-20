import react from '@vitejs/plugin-react'
import restart from 'vite-plugin-restart'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

export default {
    root: 'src/', // Sources files (typically where index.html is)
    publicDir: '../static/', // Path from "root" to static assets (files that are served as they are)
    server:
    {
        host: true, // Open to local network and display URL
        port: process.env.PORT ? Number(process.env.PORT) : 5173,
        open: !('SANDBOX_URL' in process.env || 'CODESANDBOX_HOST' in process.env) // Open if it's not a CodeSandbox
    },
    build:
    {
        outDir: '../dist', // Output in the dist/ folder
        emptyOutDir: true, // Empty the folder first
        sourcemap: true, // Add sourcemap
        rollupOptions:
        {
            input:
            {
                main: resolve(projectRoot, 'src/index.html'),      // Sunset Drive — endless PS1 cruise (React Three Fiber)
                burnout: resolve(projectRoot, 'src/burnout.html'), // Burnout-style prototype (React Three Fiber)
            },
        },
    },
    plugins:
    [
        react(),
        restart({ restart: [ '../static/**', ] }) // Restart server on static file change
    ],
}
