import { answerQuestion, offer, routeFast, wantsOrderStatus, type ChatContext, type ChatMessage, type OrderRow } from './_lib/core.js'
import { FALLBACK_ARTICLES } from './_lib/fallback-kb.js'

// Simple per-instance throttle (best effort on serverless): 15 requests / 10 min per IP.
const hits = new Map<string, number[]>()
function limited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 600_000)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) hits.clear()
  return recent.length > 15
}

// Tiny in-memory cache for repeated single-turn questions (saves the free-tier token budget).
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
  const apiKey = process.env.GROQ_API_KEY
  const supaUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supaKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!apiKey || !supaUrl || !supaKey) return json({ error: 'Chat is not configured' }, 500)

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (limited(ip)) {
    return json(offer('You are sending messages very quickly. Give me a moment, or would you like me to connect you with my team?', 'throttled'))
  }

  let body: { messages?: unknown; name?: unknown; memory?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid request' }, 400)
  }
  const messages = clean(body.messages)
  if (!messages) return json({ error: 'Invalid request' }, 400)

  // Optional first name for a friendlier tone (letters only, short).
  const rawName = typeof body.name === 'string' ? body.name.trim().split(/\s+/)[0] : ''
  const name = /^[\p{L}'-]{2,24}$/u.test(rawName) ? rawName : undefined

  // Products discussed earlier (echoed back by the client) so the bot keeps context beyond the message window.
  const memory = (Array.isArray(body.memory) ? body.memory : [])
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.trim().slice(0, 120))
    .filter(Boolean)
    .slice(-5)

  const fast = routeFast(messages, name)
  if (fast) return json({ ...fast, memory })

  // Retrieval (RAG): the search uses the recent conversation and remembered products, not just the last message.
  const query = [...memory, ...messages.slice(-4).map((m) => m.content.slice(0, 300))].join(' ').slice(0, 900)

  let context: ChatContext
  try {
    const res = await fetch(`${supaUrl}/rest/v1/rpc/chat_context`, {
      method: 'POST',
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_query: query }),
    })
    if (!res.ok) throw new Error(String(res.status))
    context = (await res.json()) as ChatContext
  } catch {
    // Database unreachable: still answer basics from the built-in core articles, never about products.
    context = { articles: FALLBACK_ARTICLES, products: [] }
  }

  // Read-only: the signed-in customer's OWN recent orders, fetched with THEIR token so database rules apply.
  const lastText = messages[messages.length - 1].content
  if (wantsOrderStatus(lastText)) {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    context.orders = null
    if (token) {
      try {
        const r = await fetch(
          `${supaUrl}/rest/v1/orders?select=id,quantity,unit_price,status,created_at,products(name)&order=created_at.desc&limit=5`,
          { headers: { apikey: supaKey, Authorization: `Bearer ${token}` } },
        )
        if (r.ok) context.orders = (await r.json()) as OrderRow[]
      } catch {
        context.orders = null
      }
    }
  }

  // Only plain first questions (no history, no remembered products, no name) are cached.
  const cacheKey = messages.length === 1 && memory.length === 0 && !name ? norm(messages[0].content) : null
  const hit = cacheKey ? cache.get(cacheKey) : undefined
  if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.reply)

  const { model: _model, ...reply } = await answerQuestion({ messages, context, apiKey, name, memory })
  // Cache only model-written FAQ answers that rely on knowledge articles (never prices or stock, which change).
  const faqOnly = Array.isArray(reply.sources) && reply.sources.length > 0 && reply.sources.every((x) => !/^p\d+$/.test(x.id))
  if (cacheKey && _model && faqOnly && reply.action === 'answer' && reply.intent === 'question' && reply.verified) {
    if (cache.size > 300) cache.clear()
    cache.set(cacheKey, { at: Date.now(), reply: { ...reply } })
  }
  return json(reply)
}
