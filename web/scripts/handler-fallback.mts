// Calls /api/chat with the database unreachable (RPC returns 404) to confirm graceful behaviour.
import { writeFileSync, appendFileSync } from 'node:fs'
process.env.SUPABASE_URL = 'https://stub.supabase.co'
process.env.SUPABASE_PUBLISHABLE_KEY = 'stub'
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: any, init?: any) =>
  String(url).startsWith('https://stub.supabase.co') ? new Response('{}', { status: 404 }) : realFetch(url, init)) as typeof fetch
const { POST } = await import('../api/chat.ts')
const OUT = new URL('../fallback-out.txt', import.meta.url)
writeFileSync(OUT, '')
for (const q of ['hi', 'Hello!', 'thanks', 'which product available', 'How do I place an order?']) {
  const res = await POST(new Request('http://x/api/chat', { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify({ messages: [{ role: 'user', content: q }] }) }))
  const b = await res.json()
  appendFileSync(OUT, `${q} -> ${res.status} ${b.action}/${b.intent}: ${b.answer}\n`)
  await new Promise((r) => setTimeout(r, 8000))
}
appendFileSync(OUT, 'done\n')
