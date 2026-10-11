import { runSupportAi, type AiMode, type OrderData, type TicketData, type ThreadMessage } from './_lib/supportAi.js'
import type { ChatContext } from './_lib/core.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hits = new Map<string, number[]>()
const limited = (key: string) => {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 600_000)
  recent.push(now)
  hits.set(key, recent)
  return recent.length > 40
}

/** Admin only. Reads the ticket with the admin's own token (database rules apply) and asks the AI for a draft. */
export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.GROQ_API_KEY
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!apiKey || !url || !key) return json({ error: 'AI is not configured' }, 500)

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Please sign in' }, 401)
  const h = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const get = async <T,>(path: string): Promise<T | null> => {
    try {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers: h })
      return r.ok ? ((await r.json()) as T) : null
    } catch {
      return null
    }
  }

  // Only admins may use this.
  let isAdmin = false
  try {
    const r = await fetch(`${url}/rest/v1/rpc/is_admin`, { method: 'POST', headers: h, body: '{}' })
    isAdmin = r.ok && (await r.json()) === true
  } catch {
    isAdmin = false
  }
  if (!isAdmin) return json({ error: 'Admins only' }, 403)
  if (limited(token.slice(-24))) return json({ error: 'Too many AI requests. Please wait a few minutes.' }, 429)

  let body: { mode?: string; ticketId?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid request' }, 400)
  }
  const mode = body.mode as AiMode
  if (!['suggest_reply', 'summarize', 'kb_draft'].includes(mode) || !body.ticketId || !UUID.test(body.ticketId)) return json({ error: 'Invalid request' }, 400)

  const tickets = await get<(TicketData & { user_id: string | null })[]>(`support_requests?id=eq.${body.ticketId}&select=id,contact,question,status,user_id`)
  const ticket = tickets?.[0]
  if (!ticket) return json({ error: 'Ticket not found' }, 404)
  const thread = (await get<(ThreadMessage & { is_internal: boolean })[]>(`ticket_comments?ticket_id=eq.${ticket.id}&select=author_role,body,is_internal&order=created_at.asc`)) ?? []
  const publicThread = thread.filter((m) => !m.is_internal)

  let orders: OrderData[] = []
  let name: string | null = null
  if (ticket.user_id && UUID.test(ticket.user_id)) {
    orders = (await get<OrderData[]>(`orders?user_id=eq.${ticket.user_id}&select=quantity,unit_price,status,created_at,courier,tracking_number,products(name)&order=created_at.desc&limit=5`)) ?? []
    const prof = await get<{ full_name: string | null }[]>(`profiles?id=eq.${ticket.user_id}&select=full_name`)
    name = prof?.[0]?.full_name?.split(/\s+/)[0] ?? null
  }

  let context: ChatContext | null = null
  if (mode === 'suggest_reply') {
    try {
      const q = [ticket.question, ...publicThread.slice(-3).map((m) => m.body)].join(' ').slice(0, 900)
      const r = await fetch(`${url}/rest/v1/rpc/chat_context`, { method: 'POST', headers: h, body: JSON.stringify({ p_query: q }) })
      if (r.ok) context = (await r.json()) as ChatContext
    } catch {
      context = null
    }
  }

  const outcome = await runSupportAi({ mode, ticket: { ...ticket, customer_name: name }, thread: publicThread, orders, context, apiKey })
  if (!outcome.ok) return json({ error: outcome.error }, outcome.busy ? 429 : 502)

  // Summaries are stored so each ticket is analysed only once.
  if (mode === 'summarize' && outcome.result.summary) {
    await fetch(`${url}/rest/v1/rpc/admin_set_ticket_ai`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ p_ticket: ticket.id, p_summary: outcome.result.summary, p_category: outcome.result.category, p_priority: outcome.result.priority }),
    }).catch(() => undefined)
  }
  const { model: _model, ...result } = outcome.result
  return json(result)
}
