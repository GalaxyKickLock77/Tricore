// Dev-only: lets Node (type stripping) resolve "./x.js" imports to "./x.ts", like the Vercel build does.
import { register } from 'node:module'
register('./ts-resolve-hooks.mjs', import.meta.url)
