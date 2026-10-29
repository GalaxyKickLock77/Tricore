import { routeFast, type ChatMessage } from './_lib/core.js'
import { runAssistant } from './_lib/assistant.js'

const hits = new Map<string, number[]>()
function limited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 600_000)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) hits.clear()
  return recent.length > 15
}

// Public, evergreen knowledge-base answers, so a busy FAQ does not burn the model's free-tier tokens.
// Never private or live data: see the cache rule where it is used.
const cache = new Map<string, { at: number; reply: Record<string, unknown> }>()
const CACHE_MS = 15 * 60_000
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function clean(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0) return null
  const msgs = input
    .filter((m): m is { role: string; content: string } => !!m && typeof m.content === 'string' && typeof m.role === 'string')
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as ChatMessage['role'], content: m.content.trim().slice(0, m.role === 'assistant' ? 500 : 600) }))
    .filter((m) => m.content.length > 0)
    .slice(-8)
  if (msgs.length === 0 || msgs[msgs.length - 1].role !== 'user') return null
  return msgs
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.CLINE_API_KEY
  const supaUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supaKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!apiKey || !supaUrl || !supaKey) return json({ error: 'Chat is not configured' }, 500)

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (limited(ip)) {
    return json({
      action: 'offer_team',
      intent: 'question',
      answer: 'You are sending messages very quickly. Give me a moment, or would you like me to connect you with my team?',
      sources: [],
      verified: true,
      handoffReason: 'throttled',
    })
  }

  let body: { messages?: unknown; name?: unknown; memory?: unknown; page?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid request' }, 400)
  }
  const messages = clean(body.messages)
  if (!messages) return json({ error: 'Invalid request' }, 400)

  const rawName = typeof body.name === 'string' ? body.name.trim().split(/\s+/)[0] : ''
  const name = /^[\p{L}'-]{2,24}$/u.test(rawName) ? rawName : undefined
  const page = typeof body.page === 'string' ? body.page.trim().slice(0, 100) : ''
  // The customer's own token. Every database call the tools make runs under it, so row level security
  // decides what this person may see; the server never holds a secret key here.
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || undefined

  const memory = (Array.isArray(body.memory) ? body.memory : [])
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.trim().slice(0, 120))
    .filter(Boolean)
    .slice(-5)

  // Small talk and an explicit request for a person are settled without the model.
  const fast = routeFast(messages, name)
  if (fast) return json({ ...fast, memory })

  // A repeated public FAQ question gets the stored answer instead of model tokens.
  const cacheKey = messages.length === 1 && memory.length === 0 && !name && !token ? norm(messages[0].content) : null
  if (cacheKey) {
    const hit = cache.get(cacheKey)
    if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.reply)
  }

  // Staff status is read with the customer's own token through is_admin(); it only chooses the wording of
  // the instructions. The database policies, not this flag, decide which rows the tools can return.
  let isAdmin = false
  if (token) {
    try {
      const res = await fetch(`${supaUrl}/rest/v1/rpc/is_admin`, {
        method: 'POST',
        headers: { apikey: supaKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (res.ok) isAdmin = (await res.json()) === true
    } catch { /* ignore */ }
  }

  const reply = await runAssistant({
    messages,
    apiKey,
    name,
    page,
    memory,
    isAdmin,
    runtime: { supaUrl, supaKey, token, fetchImpl: fetch },
  })

  // Only a signed-out question answered purely from a knowledge article may be reused: nothing personal,
  // nothing live. Ticket, order and stock figures always go back to the database.
  const publicFaq =
    reply.action === 'answer' && reply.intent === 'question' && reply.verified && !reply.link && !reply.order &&
    reply.sources.length > 0 && reply.sources.every((s) => !s.id.includes(':') && !/^p\d+$/.test(s.id))
  if (cacheKey && publicFaq) {
    if (cache.size > 300) cache.clear()
    cache.set(cacheKey, { at: Date.now(), reply: { ...reply } as unknown as Record<string, unknown> })
  }
  return json(reply)
}
