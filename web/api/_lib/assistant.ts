import {
  ZRO_CHAT_COMPLETIONS_URL,
  MODELS,
  extractJson,
  numbersAreGrounded,
  offer,
  tidy,
  type BotReply,
  type ChatMessage,
} from './core.js'
import { ASSISTANT_RESPONSE_TOOL, ASSISTANT_TOOLS, type AssistantLink, type AssistantModelMessage, type AssistantToolCall } from './assistant-schema.js'
import { emptyToolState, executeAssistantTool, type AssistantRuntime } from './assistant-tools.js'

export interface AssistantReply extends BotReply {
  link?: AssistantLink
}

interface ModelMessage {
  role: 'assistant'
  content: string | null
  reasoning_content?: string
  tool_calls?: AssistantToolCall[]
}

interface ModelResult {
  message?: ModelMessage
  model?: string
  rateLimited: boolean
  toolCallFailed?: boolean
}

const UNAVAILABLE = "I'm having trouble reaching the assistant right now. Would you like me to connect you with my team?"
const UNSURE = "I couldn't verify that answer from Tricore's live information. Would you like me to connect you with my team?"
const FORBIDDEN = /(gsk_[a-z0-9]+|op-[a-z0-9]+|sk-ar-[a-z0-9]+|system prompt|api[_ ]?key)/i

function systemPrompt(name: string | undefined, page: string, signedIn: boolean, isAdmin: boolean) {
  return `You are Tricore IT Solutions' AI shopping, account and store assistant.

STATE: ${isAdmin ? 'Signed in as an ADMIN of the store (sees every order, ticket and product).' : signedIn ? 'Signed in as a customer.' : 'NOT signed in.'} Page: ${page || 'unknown'}.${name ? ` Name: ${name}.` : ''}

TOOLS - call them before you answer; you have no facts of your own:
- search_store: products, prices, stock, policies, how-to. REQUIRED before answering any product question, including a named product, model, or item even when the user does not say "product". Never answer such a question from memory.
- read_account: live counts and status for orders, support tickets and the catalogue. REQUIRED for every question about a support ticket or case, and for any "how many", "are there", "what is the status", "recent", "this week/30 days" or ticket/order overview question - including an admin asking about the whole store. For ticket process or policy questions, also use search_store. The payload says what you may see (viewer_scope), gives figures per status, and carries status_vocabulary mapping everyday words (closed, completed, unpaid, on the way...) onto real status values.
- prepare_checkout: after search_store, with the exact product id and quantity. Validates stock. Places no order.
- show_page: adds a navigation button. Use it when the page is the natural next step (admin: /admin/support, /admin/orders, /admin/products; customer: /orders, /tickets; visitor: /login or /shop).

RULES:
- Every fact comes from a tool result in this conversation. Never say you cannot see counts, tickets, orders or stock without having called the tool, and never send someone to a page instead of answering when read_account can answer them.
- All product prices are Indian rupees (INR). The legacy database field name price_usd does not indicate the currency; use the price_inr value from search_store, prefix prices with ₹, and never label them $ or USD.
- For every new user question about a product or ticket, make a fresh relevant tool call before answering. Do not reuse a previous turn's answer or tool result as the source for the new question.
- For "what do you sell", "what products do you have", or a broad catalog question, describe only exact item names and details from the search_store products array. Do not turn examples in knowledge articles into products. Cite at least one product source returned by search_store.
- For "how many tickets are available/in the support section" or "how many tickets does the store have", answer from tickets.total and briefly include open, in_progress and resolved counts from the same result. "Available" without a status means the total, not just open tickets. Use viewer_scope to say whether the figures are for the store or only the signed-in customer.
- For a status-specific ticket question, use its exact field: tickets.open, tickets.in_progress, tickets.resolved, or tickets.pending. The payload defines pending; do not substitute one status for another.
- Copy numbers exactly as the tools returned them; choose the right status using status_vocabulary and the definitions in the payload (for example pending is defined there). Do not invent percentages, averages, rates or dates, and do not do arithmetic on figures you were not given.
- Stay inside viewer_scope: an admin's answer may use store-wide data; a customer's answer may use only their own records and public products. Never reveal another customer's details.
- Signed-out buy/checkout/orders/tickets requests -> call show_page /login and ask them to sign in.
- Signed-out product browsing, availability, price or catalog requests -> call show_page /login; do not answer from an empty product result.
- Never place orders, take payments, change prices, stock or ticket status.
- Discounts, deals, bulk pricing or anything you cannot do -> action offer_team and ask first.
- Missing detail (a spec, shipping charge, delivery time) -> say you do not have it and that the team confirms after the order. Do not guess.
- Off-topic (poems, coding, trivia, news, homework) -> intent offtopic, short friendly redirect, do not do the task.
- Never ask for passwords, OTPs, card or bank details.

STYLE: friendly and natural, like a knowledgeable shop assistant. 1-5 short sentences. Keep product names, statuses and prices exact. Answer first, then at most one useful follow-up. Reply in the customer's language (English, Hindi, Telugu, Tamil...). Never claim to be human; if asked, say you are Tricore's virtual assistant.

OUTPUT: ONE JSON object, no markdown:
{"intent":"greeting|offtopic|question","action":"answer|offer_team|handoff","answer":"text","handoff_reason":"","sources":["ids from the tool results you used"]}
Greetings and small talk may have empty sources. The server adds buttons and checks every number against the tool results.`
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Returns the answer JSON from a rejected {"name":"JSON","arguments":{...}} generation, or null.
function recoverPseudoJson(raw: string): string | null {
  try {
    const failed = (JSON.parse(raw) as { error?: { failed_generation?: unknown } }).error?.failed_generation
    if (typeof failed !== 'string') return null
    const call = JSON.parse(failed) as { name?: unknown; arguments?: unknown }
    if (typeof call.name !== 'string' || call.name.toLowerCase() !== 'json') return null
    if (!call.arguments || typeof call.arguments !== 'object' || typeof (call.arguments as { answer?: unknown }).answer !== 'string') return null
    return JSON.stringify(call.arguments)
  } catch {
    return null
  }
}

// One request to one model. Returns the message, or the HTTP status and Retry-After when it failed.
async function requestOnce(
  apiKey: string,
  model: (typeof MODELS)[number],
  messages: AssistantModelMessage[],
  fetchImpl: typeof fetch,
  allowTools: boolean,
  forceTool?: string,
): Promise<{ message?: ModelMessage; status?: number; retryable?: boolean; retryAfterMs?: number; toolCallFailed?: boolean }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20_000)
  try {
    const res = await fetchImpl(ZRO_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.id,
        messages,
        // Keep the tools list even when tools are disabled for providers that validate tool declarations.
        tools: allowTools ? ASSISTANT_TOOLS : [...ASSISTANT_TOOLS, ASSISTANT_RESPONSE_TOOL],
        tool_choice: allowTools
          ? forceTool
            ? { type: 'function', function: { name: forceTool } }
            : 'required'
          : { type: 'function', function: { name: ASSISTANT_RESPONSE_TOOL.function.name } },
        temperature: 0.2,
        max_tokens: 768,
        ...model.extra,
      }),
      signal: ctl.signal,
    })
    if (!res.ok) {
      const seconds = Number(res.headers.get('retry-after'))
      const raw = await res.text().catch(() => '')
      const detail = raw.replace(/\s+/g, ' ').slice(0, 300)
      console.warn(`[assistant] ${model.id} HTTP ${res.status} retry-after=${res.headers.get('retry-after') ?? '-'} ${detail}`)
      // Some OpenAI-compatible providers include the attempted output in failed_generation.
      const recovered = recoverPseudoJson(raw)
      if (recovered) return { message: { role: 'assistant', content: recovered } }
      // A malformed tool call (400 tool_use_failed) is random sampling noise, so one more try usually works.
      const malformed = res.status === 400 && raw.includes('tool_use_failed')
      // A daily token limit (TPD) does not clear in seconds, so do not retry it on this model.
      const dailyLimit = res.status === 429 && /per day|TPD/.test(raw)
      const retryable = malformed || (!dailyLimit && (res.status === 429 || res.status >= 500))
      return {
        status: res.status,
        retryable,
        retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
        toolCallFailed: malformed,
      }
    }
    const envelope = await res.json() as { data?: { choices?: { message?: ModelMessage }[] }; choices?: { message?: ModelMessage }[] }
    const choices = envelope.data?.choices ?? envelope.choices
    const message = choices?.[0]?.message
    const responseCall = message?.tool_calls?.find((call) => call.function?.name === ASSISTANT_RESPONSE_TOOL.function.name)
    return {
      message: responseCall?.function?.arguments
        ? { ...message!, content: responseCall.function.arguments, tool_calls: undefined }
        : message,
    }
  } catch {
    return {}
  } finally {
    clearTimeout(timer)
  }
}

async function callModel(
  apiKey: string,
  messages: AssistantModelMessage[],
  fetchImpl: typeof fetch,
  allowTools: boolean,
  forceTool?: string,
): Promise<ModelResult> {
  let rateLimited = false
  for (const model of MODELS) {
    // Rate limits (429) and server errors are retried with a short wait before trying the next model.
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await requestOnce(apiKey, model, messages, fetchImpl, allowTools, forceTool)
      if (result.message) return { message: result.message, model: model.id, rateLimited }
      if (result.status === 429) rateLimited = true
      if (result.toolCallFailed && forceTool) return { rateLimited, toolCallFailed: true }
      if (!result.retryable || attempt === 2) break
      // Wait for Retry-After when given, otherwise back off 1.5s, 3s. Keep the total wait short.
      await sleep(Math.min(result.retryAfterMs ?? 1500 * 2 ** attempt, 6000))
    }
  }
  return { rateLimited }
}

function toolCalls(message: ModelMessage): AssistantToolCall[] {
  if (!Array.isArray(message.tool_calls)) return []
  return message.tool_calls.filter((call) =>
    call && call.type === 'function' && typeof call.id === 'string' &&
    typeof call.function?.name === 'string' && typeof call.function.arguments === 'string',
  ).slice(0, 3)
}

function parseArgs(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return {} }
}

function isPurchaseRequest(question: string): boolean {
  const asksAboutExistingOrder = /\b(my order|order status|track|tracking|cancel|refund|where is my order|latest order|recent order)\b/i.test(question)
  return /\b(buy|purchase|order|checkout)\b/i.test(question) && !asksAboutExistingOrder
}

function hasNamedProduct(question: string, state: ReturnType<typeof emptyToolState>): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const normalizedQuestion = normalize(question)
  return [...state.sources.values()].some((source) =>
    source.id.startsWith('product:') && normalizedQuestion.includes(normalize(source.title)),
  )
}

function requiredToolArgs(question: string, tool: string, signedIn = false, state?: ReturnType<typeof emptyToolState>): Record<string, unknown> {
  if (tool === 'show_page') return signedIn
    ? { page: '/shop', label: 'Choose a product' }
    : { page: '/login', label: 'Sign in to continue' }
  if (tool === 'search_store') return { query: question.slice(-400) }
  if (tool === 'prepare_checkout') {
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const normalizedQuestion = normalize(question)
    const product = [...(state?.sources.values() ?? [])].find((source) =>
      source.id.startsWith('product:') && normalizedQuestion.includes(normalize(source.title)),
    )
    const quantity = /\b(?:buy|purchase|order|checkout)\s+(\d+)\b/i.exec(question)
    return { product_id: product?.id ?? '', quantity: quantity ? Number(quantity[1]) : 1 }
  }
  if (tool === 'read_account') {
    const resource = /\b(tickets?|support requests?|support cases?)\b/i.test(question)
      ? 'tickets'
      : /\b(orders?|purchases?|deliveries)\b/i.test(question)
        ? 'orders'
        : /\b(products?|stock|inventory)\b/i.test(question)
          ? 'catalog'
          : 'all'
    return { resource }
  }
  return {}
}

function requiredToolForQuestion(question: string, signedIn: boolean): string | undefined {
  const needsAccount = /\b(check ?out|buy|purchase|orders?|tickets?|account)\b/i.test(question)
  const asksAboutProducts = /\b(products?|sell|catalog|catalogue|price|cost|available|stock|items?|carry|recommend|compare|specs?)\b/i.test(question) ||
    /\bdo you (have|sell|carry|stock|offer)\b/i.test(question)
  if (!signedIn && (needsAccount || asksAboutProducts)) return 'show_page'
  if (signedIn && /\bcheckout\b\s*[.!?]*$/i.test(question)) return 'show_page'
  if (isPurchaseRequest(question)) return 'search_store'
  if (/\b(tickets?|support requests?|support cases?)\b/i.test(question)) return 'read_account'
  const asksForLiveFigures = /\b(how many|how much|number of|count|are there|what(?:'s| is) the status|recent|this week|this month)\b/i.test(question)
  if (asksForLiveFigures && /\b(tickets?|support requests?|orders?|products?|stock)\b/i.test(question)) return 'read_account'
  if (/\b(products?|sell|catalog|catalogue|price|cost|available|stock|item|items|carry|recommend|compare|specs?)\b/i.test(question) || /\bdo you (have|sell|carry|stock|offer)\b/i.test(question)) return 'search_store'
  return undefined
}

function withFallback(memory: string[] | undefined, answer: string, reason: string): AssistantReply {
  return { ...offer(answer, reason), memory }
}

export async function runAssistant(opts: {
  messages: ChatMessage[]
  apiKey: string
  name?: string
  page?: string
  memory?: string[]
  /** True when the caller's own token passes the is_admin() check; the database still decides what they can read. */
  isAdmin?: boolean
  runtime: AssistantRuntime
}): Promise<AssistantReply> {
  const { messages, apiKey, runtime } = opts
  const memory = opts.memory?.slice(-5)
  const state = emptyToolState()
  const conversation: AssistantModelMessage[] = [
    { role: 'system', content: systemPrompt(opts.name, (opts.page ?? '').slice(0, 100), !!runtime.token, !!opts.isAdmin) },
    ...messages.slice(-12).map((m) => ({ role: m.role, content: m.content })),
  ]
  let usedModel: string | undefined
  let sawRateLimit = false

  // Two tool rounds followed by a final structured answer. A normal request uses two model calls.
  // Signed-out buy/checkout requests must always get the sign-in button, so the first round is forced to call show_page.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const requiredTool = requiredToolForQuestion(lastUser, !!runtime.token)
  const isPurchase = isPurchaseRequest(lastUser)
  if (!runtime.token && requiredTool === 'show_page') {
    const content = await executeAssistantTool('show_page', requiredToolArgs(lastUser, requiredTool), runtime, state)
    if (JSON.parse(content).path === '/login' && state.link) {
      return {
        action: 'answer', intent: 'question', answer: 'Please sign in to browse the catalog and account details.',
        sources: [], verified: true, memory, link: state.link,
      }
    }
  }
  for (let round = 0; round < 3; round++) {
    const forced = round === 0
      ? requiredTool
      : round === 1 && isPurchase && hasNamedProduct(lastUser, state)
        ? 'prepare_checkout'
        : undefined
    let result = await callModel(apiKey, conversation, runtime.fetchImpl, round < 2, forced)
    const calledRequiredTool = result.message && forced && toolCalls(result.message).some((call) => call.function.name === forced)
    if (forced && !calledRequiredTool) {
      const args = requiredToolArgs(lastUser, forced, !!runtime.token, state)
      const call: AssistantToolCall = {
        id: 'server-tool-recovery',
        type: 'function',
        function: { name: forced, arguments: JSON.stringify(args) },
      }
      const content = await executeAssistantTool(call.function.name, args, runtime, state)
      conversation.push(
        { role: 'assistant', content: null, tool_calls: [call] },
        { role: 'tool', tool_call_id: call.id, content },
      )
      const checkoutTool = forced === 'search_store' && isPurchase && hasNamedProduct(lastUser, state)
        ? 'prepare_checkout'
        : undefined
      result = await callModel(apiKey, conversation, runtime.fetchImpl, !!checkoutTool, checkoutTool)
    }
    sawRateLimit ||= result.rateLimited
    if (!result.message) {
      if (state.link?.path === '/login') {
        return {
          action: 'answer', intent: 'question', answer: 'Please sign in to continue.',
          sources: [], verified: true, memory, link: state.link,
        }
      }
      return withFallback(memory, sawRateLimit ? UNAVAILABLE : UNSURE, sawRateLimit ? 'model rate limited' : 'model unavailable')
    }
    usedModel = result.model
    const message = result.message
    const calls = round < 2 ? toolCalls(message) : []

    if (calls.length) {
      conversation.push({ role: 'assistant', content: message.content, tool_calls: calls })
      for (const call of calls) {
        const content = await executeAssistantTool(call.function.name, parseArgs(call.function.arguments), runtime, state)
        conversation.push({ role: 'tool', tool_call_id: call.id, content })
      }
      continue
    }

    const raw = typeof message.content === 'string' && message.content.trim()
      ? message.content.trim()
      : typeof (message as any).reasoning_content === 'string'
        ? (message as any).reasoning_content.trim()
        : ''
    const parsed = extractJson(raw) as Record<string, unknown> | null
    if (!parsed || typeof parsed.answer !== 'string') {
      if (round < 2) {
        conversation.push(
          { role: 'assistant', content: raw || null },
          { role: 'user', content: 'Return the required JSON object only. Use available tools for live facts.' },
        )
        continue
      }
      return withFallback(memory, UNSURE, 'unparseable model output')
    }

    const answer = tidy(parsed.answer.trim().slice(0, 1200))
    const intent = (['greeting', 'offtopic', 'question'] as const).includes(parsed.intent as never)
      ? parsed.intent as BotReply['intent']
      : 'question'
    let action = (['answer', 'offer_team', 'handoff'] as const).includes(parsed.action as never)
      ? (parsed.action as BotReply['action'])
      : 'answer'
    const clarifying = /\?\s*$/.test(answer) && !/[\d$₹]/.test(answer)
    const needsSources = intent === 'question' && !clarifying && action !== 'handoff' && !state.link
    if (!answer || FORBIDDEN.test(answer)) return withFallback(memory, UNSURE, 'failed safety check')
    if (needsSources && state.sources.size === 0) return withFallback(memory, UNSURE, 'answer used no live source')
    const userText = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
    if (!numbersAreGrounded(answer, `${state.contextText.join('\n')}\n${userText}`, state.prices)) {
      return withFallback(memory, UNSURE, 'answer contained unverified numbers')
    }

    const requestedSources = Array.isArray(parsed.sources) ? parsed.sources : []
    let sources = requestedSources
      .filter((id): id is string => typeof id === 'string' && state.sources.has(id))
      .map((id) => state.sources.get(id)!)
    if (sources.length === 0 && state.sources.size > 0) sources = [...state.sources.values()].slice(0, 8)
    if (state.order) action = 'confirm_order'
    else if (action === 'confirm_order') action = 'answer'
    let text = answer
    // The contact form only opens on an explicit request (handled before the model runs) or a "yes" to
    // this offer, so an unprompted handoff becomes a question first.
    if (action === 'handoff') {
      action = 'offer_team'
      if (!/\?\s*$/.test(text)) text = `${text} Would you like me to connect you with my team?`
    }
    return {
      action,
      answer: text,
      intent: action === 'answer' ? intent : 'question',
      sources: action === 'answer' && intent !== 'question' ? [] : sources,
      verified: true,
      handoffReason: action === 'offer_team'
        ? String(parsed.handoff_reason ?? '').slice(0, 300)
        : undefined,
      model: usedModel,
      memory,
      ...(state.order ? { order: state.order } : {}),
      ...(state.link ? { link: state.link } : {}),
    }
  }
  return withFallback(memory, UNSURE, 'assistant did not finish')
}
