import type { ChatContext, KbProduct, OrderProposal } from './core.js'
import {
  PAGE_LABELS,
  PAGE_PATHS,
  type AssistantLink,
  type PagePath,
} from './assistant-schema.js'

export interface AssistantRuntime {
  supaUrl: string
  supaKey: string
  token?: string
  fetchImpl: typeof fetch
}

export interface ToolState {
  sources: Map<string, { id: string; title: string }>
  contextText: string[]
  prices: number[]
  order?: OrderProposal
  link?: AssistantLink
}

export const emptyToolState = (): ToolState => ({ sources: new Map(), contextText: [], prices: [] })

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const text = (args: Record<string, unknown>, key: string, max: number) =>
  typeof args[key] === 'string' ? (args[key] as string).trim().slice(0, max) : ''

async function supabase(runtime: AssistantRuntime, path: string, body?: unknown, userToken = false) {
  const authorization = userToken ? runtime.token : (runtime.token ?? runtime.supaKey)
  const res = await runtime.fetchImpl(`${runtime.supaUrl}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      apikey: runtime.supaKey,
      Authorization: `Bearer ${authorization ?? ''}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!res.ok) throw new Error(`Supabase request failed (${res.status})`)
  return await res.json() as unknown
}

function addProduct(state: ToolState, product: KbProduct) {
  state.sources.set(product.id, { id: product.id, title: product.name })
  state.prices.push(Number(product.price_usd))
}

async function searchStore(args: Record<string, unknown>, runtime: AssistantRuntime, state: ToolState) {
  const query = text(args, 'query', 400)
  if (!query) return { error: 'A non-empty search query is required.' }
  const raw = asRecord(await supabase(runtime, 'rpc/chat_context', { p_query: query }))
  const context: ChatContext = {
    articles: Array.isArray(raw.articles) ? raw.articles as ChatContext['articles'] : [],
    products: Array.isArray(raw.products) ? raw.products as ChatContext['products'] : [],
    total_products: typeof raw.total_products === 'number' ? raw.total_products : 0,
  }
  // The catalog is an authenticated feature. Knowledge articles remain available to visitors.
  if (!runtime.token) {
    context.products = []
    context.total_products = 0
  }
  context.articles = context.articles.slice(0, 7).map((a) => ({
    id: String(a.id).slice(0, 100),
    title: String(a.title).slice(0, 160),
    content: String(a.content).slice(0, 900),
  }))
  context.products = context.products.slice(0, 20).map((p) => ({
    id: String(p.id),
    name: String(p.name).slice(0, 180),
    price_usd: Number(p.price_usd),
    availability: String(p.availability).slice(0, 40),
    description: String(p.description ?? '').slice(0, 220),
  })).filter((p) => p.id && p.name && Number.isFinite(p.price_usd))
  for (const a of context.articles) state.sources.set(a.id, { id: a.id, title: a.title })
  for (const p of context.products) addProduct(state, p)
  const payload = {
    articles: context.articles,
    products: context.products,
    total_products: context.total_products,
    catalog_note: runtime.token
      ? 'Live results. Product ids are stable ids to pass to prepare_checkout after removing product:.'
      : 'Sign in is required to browse products and prices.',
  }
  state.contextText.push(JSON.stringify(payload))
  return payload
}

const ACCOUNT_SOURCES: Record<string, { id: string; title: string }> = {
  tickets: { id: 'account:tickets', title: 'Live support ticket data' },
  orders: { id: 'account:orders', title: 'Live order data' },
  catalog: { id: 'account:catalog', title: 'Live catalogue and stock data' },
}

/**
 * Live figures for the person asking. The database function runs with the caller's own token, so row
 * level security decides the scope: a customer gets their own records, an admin gets the whole store.
 * The payload also carries the status vocabulary, so "closed" resolves to whatever the store calls done.
 */
async function readAccount(args: Record<string, unknown>, runtime: AssistantRuntime, state: ToolState) {
  const resource = text(args, 'resource', 20)
  if (!['orders', 'tickets', 'catalog', 'all'].includes(resource)) {
    return { error: 'Resource must be orders, tickets, catalog, or all.' }
  }
  if (!runtime.token) {
    state.link = { path: '/login', label: 'Sign in to continue' }
    return { requires_sign_in: true, message: 'Ask the customer to sign in, then try again.' }
  }
  const result = asRecord(await supabase(runtime, 'rpc/chat_account_context', { p_resource: resource }, true))
  const available = Object.keys(ACCOUNT_SOURCES).filter((key) => result[key] !== null && result[key] !== undefined)
  if (available.length === 0) return { error: 'The live figures are unavailable right now. Say so honestly; do not guess.' }
  for (const key of available) state.sources.set(ACCOUNT_SOURCES[key].id, ACCOUNT_SOURCES[key])
  state.contextText.push(JSON.stringify(result))
  return result
}

interface CheckoutProduct {
  id: string
  name: string
  price: number | string
  stock: number
  is_active: boolean
}

async function prepareCheckout(args: Record<string, unknown>, runtime: AssistantRuntime, state: ToolState) {
  if (!runtime.token) {
    state.link = { path: '/login', label: 'Sign in to checkout' }
    return { requires_sign_in: true, message: 'The customer must sign in before checkout.' }
  }
  const productId = text(args, 'product_id', 80).replace(/^product:/, '')
  const quantity = args.quantity
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
    return { error: 'Use the exact product UUID returned by search_store.' }
  }
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return { error: 'Quantity must be a whole number between 1 and 50.' }
  }
  if (state.order) return { error: 'Only one product can be prepared per checkout. Use the existing checkout proposal.' }
  const rows = await supabase(
    runtime,
    `products?id=eq.${productId}&select=id,name,price,stock,is_active&is_active=eq.true&limit=1`,
    undefined,
    true,
  )
  const product = (Array.isArray(rows) ? rows[0] : null) as CheckoutProduct | null
  if (!product || typeof product.name !== 'string') return { error: 'That product is no longer available.' }
  const price = Number(product.price)
  const stock = Number(product.stock)
  const sourceId = `product:${product.id}`
  const kbProduct: KbProduct = {
    id: sourceId,
    name: product.name,
    price_usd: price,
    availability: stock < 1 ? 'out of stock' : stock <= 5 ? 'low stock' : 'in stock',
    description: '',
  }
  addProduct(state, kbProduct)
  const live = { product_id: sourceId, name: product.name, unit_price: price, stock, requested_quantity: quantity }
  state.contextText.push(JSON.stringify(live))
  if (!Number.isFinite(price) || price < 0) return { error: 'The product price is unavailable.' }
  if (stock < 1) return { ...live, error: 'This product is out of stock; do not prepare checkout.' }
  if (quantity > stock) return { ...live, error: `Only ${stock} unit(s) are available. Ask the customer to choose a valid quantity.` }
  const order: OrderProposal = { product_id: product.id, name: product.name, unit_price: price, quantity }
  state.order = order
  const payload = { ...live, checkout_ready: true, total: price * quantity, note: 'No order has been placed. The customer must continue to checkout and confirm delivery details.' }
  state.contextText.push(JSON.stringify(payload))
  return payload
}

function showPage(args: Record<string, unknown>, runtime: AssistantRuntime, state: ToolState) {
  const page = text(args, 'page', 60) as PagePath | '/login'
  if (page === '/login') {
    state.link = { path: '/login', label: text(args, 'label', 40) || 'Sign in to continue' }
    return { page_action_ready: true, path: '/login', label: state.link.label }
  }
  if (!(PAGE_PATHS as readonly string[]).includes(page)) return { error: 'Unknown app page.' }
  if (!runtime.token) {
    state.link = { path: '/login', label: 'Sign in to continue' }
    return { requires_sign_in: true, message: 'This page requires sign-in.' }
  }
  const label = text(args, 'label', 40) || PAGE_LABELS[page]
  state.link = { path: page, label }
  return { page_action_ready: true, path: page, label }
}

export async function executeAssistantTool(
  name: string,
  rawArgs: unknown,
  runtime: AssistantRuntime,
  state: ToolState,
): Promise<string> {
  const args = asRecord(rawArgs)
  try {
    let result: unknown
    if (name === 'search_store') result = await searchStore(args, runtime, state)
    else if (name === 'read_account') result = await readAccount(args, runtime, state)
    else if (name === 'prepare_checkout') result = await prepareCheckout(args, runtime, state)
    else if (name === 'show_page') result = showPage(args, runtime, state)
    else result = { error: 'Unknown tool.' }
    return JSON.stringify(result).slice(0, 18_000)
  } catch {
    return JSON.stringify({ error: 'This live data is temporarily unavailable. Be honest and do not guess.' })
  }
}
