// AI helpers for the admin support queue: suggested reply, ticket summary/priority, knowledge-base draft.
// The AI only DRAFTS. A human reads and sends/saves everything.
import { MODELS, callCline, extractJson, numbersAreGrounded, type ChatContext, type ClineResponseTool } from './core.js'

export type AiMode = 'suggest_reply' | 'summarize' | 'kb_draft'

export interface TicketData {
  id: string
  contact: string
  question: string
  status: string
  customer_name?: string | null
}
export interface ThreadMessage { author_role: 'admin' | 'customer'; body: string }
export interface OrderData {
  quantity: number
  unit_price: number
  status: string
  created_at: string
  courier?: string | null
  tracking_number?: string | null
  products?: { name: string } | null
}

const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function dataBlock(t: TicketData, thread: ThreadMessage[], orders: OrderData[], ctx: ChatContext | null): string {
  const lines = [`TICKET (${t.status})`, `Customer: ${t.customer_name || 'unknown'} <${t.contact}>`, `First message: ${t.question}`]
  if (thread.length) {
    lines.push('', 'CONVERSATION SO FAR')
    for (const m of thread) lines.push(`${m.author_role === 'admin' ? 'Team' : 'Customer'}: ${m.body}`)
  }
  if (orders.length) {
    lines.push('', "CUSTOMER'S RECENT ORDERS")
    for (const o of orders) {
      const ship = o.status === 'shipped' && o.tracking_number ? ` | ${o.courier ?? 'courier'} ${o.tracking_number}` : ''
      lines.push(`${o.quantity} x ${o.products?.name ?? 'item'} | ${inr(o.unit_price * o.quantity)} | ${o.status} | ${o.created_at.slice(0, 10)}${ship}`)
    }
  }
  if (ctx) {
    if (ctx.articles.length) {
      lines.push('', 'KNOWLEDGE ARTICLES')
      for (const a of ctx.articles.slice(0, 6)) lines.push(`${a.title}: ${a.content.slice(0, 600)}`)
    }
    if (ctx.products.length) {
      lines.push('', 'PRODUCTS')
      for (const p of ctx.products.slice(0, 12)) lines.push(`${p.name} | ${inr(p.price_usd)} | ${p.availability}`)
    }
  }
  return lines.join('\n')
}

const OUTPUT_JSON = 'Respond with ONE JSON object only, no markdown.'

const PROMPTS: Record<AiMode, string> = {
  suggest_reply: `You help a support agent at Tricore IT Solutions (an online IT products store in India) write a reply to a customer's support ticket. The agent will read and edit your draft before sending, so write it ready to send.
RULES
- Use ONLY facts in DATA. Never invent order details, dates, prices, policies, refunds, discounts, warranty or promises.
- If the customer needs a decision from the agent (refund, discount, exception, delivery date, payment dispute), do NOT decide it. Write a polite holding line and put the question for the agent in agent_notes.
- Warm, concise (under 120 words), plain text, no markdown. Use the customer's language of their latest message. Greet by first name if known. Sign off "Tricore Support". Prices are in Indian rupees.
- Answer from the customer's order data when relevant (status, courier, tracking).
- For order-related tickets: our team reaches out to the customer to confirm the order and arrange payment and delivery directly. Do NOT ask the customer to confirm the order or to share payment details themselves; instead state that we will contact/handle it and ask them to reply if they have questions.
${OUTPUT_JSON} Keys: {"reply": string, "agent_notes": string[], "confidence": "high" | "medium" | "low"}`,
  summarize: `You classify a support ticket for the admin queue of Tricore IT Solutions.
${OUTPUT_JSON} Keys: {"summary": string (max 25 words, English), "category": "payment" | "delivery" | "order" | "product" | "account" | "complaint" | "other", "priority": "low" | "normal" | "high" | "urgent", "sentiment": "calm" | "worried" | "angry"}
Priority guide: urgent = customer says they paid but nothing is confirmed, threatens a chargeback or legal action, or the order is lost or damaged. high = delivery delay, payment problem or an unhappy customer. normal = ordinary order or product question. low = thanks, feedback or simple information.`,
  kb_draft: `You turn a RESOLVED support ticket into a reusable FAQ article for the knowledge base of Tricore IT Solutions, so a chat assistant can answer the same question next time.
RULES
- Use ONLY facts that the Team stated in the conversation. Do not add anything else.
- Remove names, emails, phone numbers, order numbers and transaction ids. Write a neutral answer in 2 to 5 sentences.
- If the Team did not state a reusable fact (for example it was only about one customer's order), set should_add to false.
${OUTPUT_JSON} Keys: {"should_add": boolean, "title": string (a short question or topic), "content": string, "reason": string}`,
}

const scrub = (t: string) =>
  t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email removed]').replace(/\+?\d[\d\s-]{8,}\d/g, '[number removed]')

export interface AiResult {
  mode: AiMode
  reply?: string
  agent_notes?: string[]
  confidence?: 'high' | 'medium' | 'low'
  summary?: string
  category?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  sentiment?: string
  should_add?: boolean
  title?: string
  content?: string
  reason?: string
  model?: string
}

export type AiOutcome = { ok: true; result: AiResult } | { ok: false; error: string; busy?: boolean }

const CATEGORIES = ['payment', 'delivery', 'order', 'product', 'account', 'complaint', 'other']
const PRIORITIES = ['low', 'normal', 'high', 'urgent']

function outputTool(mode: AiMode): ClineResponseTool {
  const shared = {
    type: 'object',
    additionalProperties: false,
  }
  const schemas: Record<AiMode, Record<string, unknown>> = {
    suggest_reply: {
      ...shared,
      properties: {
        reply: { type: 'string' },
        agent_notes: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
      required: ['reply', 'agent_notes', 'confidence'],
    },
    summarize: {
      ...shared,
      properties: {
        summary: { type: 'string' },
        category: { type: 'string', enum: CATEGORIES },
        priority: { type: 'string', enum: PRIORITIES },
        sentiment: { type: 'string', enum: ['calm', 'worried', 'angry'] },
      },
      required: ['summary', 'category', 'priority'],
    },
    kb_draft: {
      ...shared,
      properties: {
        should_add: { type: 'boolean' },
        title: { type: 'string' },
        content: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['should_add', 'title', 'content', 'reason'],
    },
  }
  return {
    type: 'function',
    function: {
      name: 'submit_support_ai_result',
      description: 'Return the requested support-ticket AI result in the defined structured fields.',
      parameters: schemas[mode],
    },
  }
}

export async function runSupportAi(opts: {
  mode: AiMode
  ticket: TicketData
  thread: ThreadMessage[]
  orders: OrderData[]
  context: ChatContext | null
  apiKey: string
  fetchImpl?: typeof fetch
}): Promise<AiOutcome> {
  const { mode, apiKey } = opts
  const fetchImpl = opts.fetchImpl ?? fetch
  const data = dataBlock(opts.ticket, opts.thread, opts.orders, mode === 'kb_draft' ? null : opts.context)
  const messages = [{ role: 'system', content: PROMPTS[mode] }, { role: 'user', content: `DATA\n${data}` }]

  let content: string | null = null
  let model = ''
  let rateLimited = false
  for (const m of MODELS) {
    const r = await callCline(apiKey, m, messages, fetchImpl, outputTool(mode))
    if (r.ok) {
      content = r.content
      model = m.id
      break
    }
    if (r.status === 429) rateLimited = true
  }
  if (content === null) {
    return { ok: false, error: rateLimited ? 'The AI is busy right now (free daily limit). Please try again in a few minutes.' : 'The AI is unavailable right now.', busy: rateLimited }
  }
  const p = extractJson(content) as Record<string, unknown> | null
  if (!p) return { ok: false, error: 'The AI answer could not be read. Please try again.' }

  if (mode === 'suggest_reply') {
    if (typeof p.reply !== 'string' || !p.reply.trim()) return { ok: false, error: 'The AI did not produce a reply. Please try again.' }
    const notes = (Array.isArray(p.agent_notes) ? p.agent_notes : []).filter((n): n is string => typeof n === 'string').slice(0, 5)
    let confidence = (['high', 'medium', 'low'] as const).find((c) => c === p.confidence) ?? 'medium'
    const prices = [...opts.orders.map((o) => o.unit_price), ...(opts.context?.products ?? []).map((x) => Number(x.price_usd))]
    if (!numbersAreGrounded(p.reply, data, prices)) {
      notes.push('Some numbers in this draft are not in the ticket or order data. Check them before sending.')
      confidence = 'low'
    }
    return { ok: true, result: { mode, reply: p.reply.trim().slice(0, 1500), agent_notes: notes, confidence, model } }
  }

  if (mode === 'summarize') {
    const category = CATEGORIES.includes(p.category as string) ? (p.category as string) : 'other'
    const priority = (PRIORITIES.includes(p.priority as string) ? p.priority : 'normal') as AiResult['priority']
    if (typeof p.summary !== 'string' || !p.summary.trim()) return { ok: false, error: 'The AI did not produce a summary. Please try again.' }
    return { ok: true, result: { mode, summary: p.summary.trim().slice(0, 250), category, priority, sentiment: typeof p.sentiment === 'string' ? p.sentiment : undefined, model } }
  }

  // kb_draft
  const should = p.should_add === true && typeof p.title === 'string' && typeof p.content === 'string' && p.content.trim().length > 20
  return {
    ok: true,
    result: {
      mode,
      should_add: should,
      title: typeof p.title === 'string' ? scrub(p.title).slice(0, 120) : '',
      content: typeof p.content === 'string' ? scrub(p.content).slice(0, 1200) : '',
      reason: typeof p.reason === 'string' ? p.reason.slice(0, 200) : '',
      model,
    },
  }
}
