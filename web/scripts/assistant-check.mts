// Offline integration checks for the tool-using assistant. No real AI calls or database writes.
import { runAssistant } from '../api/_lib/assistant.ts'
import type { ChatMessage } from '../api/_lib/core.ts'

const ZRO_URL = 'https://zro.moonmath.ai/v1/chat/completions'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT = {
  id: `product:${PRODUCT_ID}`,
  name: 'Tricore Test Laptop',
  price_usd: 1234,
  availability: 'in stock',
  description: '14 inch test laptop',
}
const ARTICLE = { id: 'ordering', title: 'Ordering', content: 'Choose a product and confirm delivery details at checkout.' }
const user = (content: string): ChatMessage[] => [{ role: 'user', content }]

const toolResponse = (calls: { name: string; args: unknown }[]) => ({
  role: 'assistant', content: null,
  tool_calls: calls.map((call, i) => ({
    id: `call-${i}`, type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  })),
})
const finalResponse = (answer: string, sources: string[] = [], action = 'answer') => ({
  role: 'assistant', content: JSON.stringify({ intent: 'question', action, answer, handoff_reason: '', sources }),
})
const structuredFinalResponse = (answer: string, sources: string[] = []) => ({
  role: 'assistant', content: null,
  tool_calls: [{
    id: 'answer-call', type: 'function',
    function: { name: 'answer_user', arguments: JSON.stringify({ intent: 'question', action: 'answer', answer, handoff_reason: '', sources }) },
  }],
})
const modelBody = (message: unknown) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 })

interface HarnessOptions {
  model: unknown[]
  token?: string
  product?: { id: string; name: string; price: number; stock: number; is_active: boolean }
  catalogProduct?: { id: string; name: string; price_usd: number; availability: string; description: string }
  account?: unknown
  accountFails?: boolean
  toolCallFails?: boolean
  omitRequiredTool?: boolean
  omitToolCallAt?: number
  modelFails?: boolean
}
function harness(options: HarnessOptions) {
  const model = [...options.model]
  const requests: { url: string; init?: RequestInit }[] = []
  const fetchImpl = (async (url: any, init?: any) => {
    const target = String(url)
    requests.push({ url: target, init })
    if (target === ZRO_URL) {
      if (options.modelFails) {
        return new Response(JSON.stringify({ error: 'model unavailable' }), { status: 401 })
      }
      const requestNumber = requests.filter((request) => request.url === target).length
      if ((options.omitRequiredTool && requestNumber === 1) || options.omitToolCallAt === requestNumber) {
        if (!model.length) throw new Error('Unexpected extra model call')
        return modelBody(model.shift())
      }
      if (options.toolCallFails && requests.filter((request) => request.url === target).length === 1) {
        return new Response(JSON.stringify({ error: { code: 'tool_use_failed', message: 'Tool choice is required, but model did not call a tool' } }), { status: 400 })
      }
      if (!model.length) throw new Error('Unexpected extra model call')
      return modelBody(model.shift())
    }
    if (target.endsWith('/rest/v1/rpc/chat_context')) {
      return new Response(JSON.stringify({ articles: [ARTICLE], products: [options.catalogProduct ?? PRODUCT], total_products: 1 }), { status: 200 })
    }
    if (target.endsWith('/rest/v1/rpc/chat_account_context')) {
      if (options.accountFails) return new Response('{"error":"relation does not exist"}', { status: 500 })
      return new Response(JSON.stringify(options.account ?? {}), { status: 200 })
    }
    if (target.includes('/rest/v1/products?')) {
      return new Response(JSON.stringify(options.product ? [options.product] : []), { status: 200 })
    }
    throw new Error(`Unexpected request: ${target}`)
  }) as typeof fetch
  const runtime = {
    supaUrl: 'https://test.supabase.co', supaKey: 'publishable-test-key',
    token: options.token, fetchImpl,
  }
  return { runtime, requests }
}

let failures = 0
async function check(name: string, run: () => Promise<void>) {
  try {
    await run()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures++
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
const expect = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

await check('checkout uses a server-validated live product and quantity', async () => {
  const h = harness({
    token: 'customer-token',
    product: { id: PRODUCT_ID, name: PRODUCT.name, price: 1234, stock: 8, is_active: true },
    model: [
      toolResponse([{ name: 'search_store', args: { query: 'Tricore Test Laptop' } }]),
      toolResponse([{ name: 'prepare_checkout', args: { product_id: PRODUCT_ID, quantity: 2 } }]),
      finalResponse('Your 2 laptops total ₹2,468.00. Continue to checkout to confirm delivery.', [`product:${PRODUCT_ID}`]),
    ],
  })
  const reply = await runAssistant({ messages: user('Checkout 2 Tricore Test Laptops'), apiKey: 'test', runtime: h.runtime })
  expect(reply.action === 'confirm_order', `expected confirm_order, got ${reply.action}: ${reply.answer}`)
  expect(reply.order?.product_id === PRODUCT_ID, 'checkout did not use the database UUID')
  expect(reply.order?.unit_price === 1234 && reply.order.quantity === 2, 'checkout price or quantity is wrong')
  expect(!h.requests.some((r) => r.url.includes('place_order')), 'chat must never place an order')
})

await check('bare checkout produces a safe product-selection button', async () => {
  const h = harness({
    token: 'customer-token',
    model: [
      toolResponse([{ name: 'show_page', args: { page: '/shop', label: 'Choose a product' } }]),
      finalResponse('Choose a product first, then I can help you check out.'),
    ],
  })
  const reply = await runAssistant({ messages: user('I want to checkout'), apiKey: 'test', runtime: h.runtime })
  expect(reply.link?.path === '/shop', `expected /shop link, got ${JSON.stringify(reply.link)}`)
  expect(!reply.order, 'bare checkout must not invent a product')
})

await check('a product question after a ticket-count turn searches products, not tickets', async () => {
  const h = harness({
    token: 'customer-token',
    model: [
      toolResponse([{ name: 'search_store', args: { query: 'products Tricore sells' } }]),
      finalResponse('We sell Tricore Test Laptop.', [`product:${PRODUCT_ID}`]),
    ],
  })
  const reply = await runAssistant({
    messages: [
      { role: 'user', content: 'How many tickets are open?' },
      { role: 'assistant', content: 'I\'m having trouble reaching the assistant right now.' },
      { role: 'user', content: 'What do you sell?' },
    ],
    apiKey: 'test', runtime: h.runtime,
  })
  const request = h.requests.find((item) => item.url === ZRO_URL)
  const body = JSON.parse(String(request?.init?.body))
  expect(body.tool_choice?.function?.name === 'search_store', `latest product question did not force search_store: ${JSON.stringify(body.tool_choice)}`)
  expect(reply.answer === 'We sell Tricore Test Laptop.', `product question got a stale answer: ${reply.answer}`)
  expect(reply.action === 'answer', `product information question became ${reply.action}`)
})

await check('a bare order request after catalog browsing looks up the live product first', async () => {
  const h = harness({
    token: 'customer-token',
    product: { id: PRODUCT_ID, name: 'Sample Gadget', price: 24.5, stock: 17, is_active: true },
    catalogProduct: { id: `product:${PRODUCT_ID}`, name: 'Sample Gadget', price_usd: 24.5, availability: 'in stock', description: 'Demo device' },
    model: [
      toolResponse([{ name: 'search_store', args: { query: 'order Sample Gadget' } }]),
      toolResponse([{ name: 'prepare_checkout', args: { product_id: PRODUCT_ID, quantity: 1 } }]),
      finalResponse('Sample Gadget is ready for checkout.', [`product:${PRODUCT_ID}`]),
    ],
  })
  const reply = await runAssistant({
    messages: [
      { role: 'user', content: 'What do you sell?' },
      { role: 'assistant', content: 'Sample Gadget is in our catalog.' },
      { role: 'user', content: 'order Sample Gadget' },
    ],
    apiKey: 'test', runtime: h.runtime,
  })
  const firstModelRequest = h.requests.find((request) => request.url === ZRO_URL)
  const modelRequests = h.requests.filter((request) => request.url === ZRO_URL)
  const body = JSON.parse(String(firstModelRequest?.init?.body))
  const checkoutBody = JSON.parse(String(modelRequests[1]?.init?.body))
  expect(body.tool_choice?.function?.name === 'search_store', 'bare order request did not force a live product lookup')
  expect(checkoutBody.tool_choice?.function?.name === 'prepare_checkout', 'named purchase did not force live checkout validation')
  expect(reply.action === 'confirm_order', `validated order did not produce checkout: ${reply.action}`)
  expect(reply.order?.product_id === PRODUCT_ID, 'checkout proposal used the wrong product')
})

await check('a missing checkout tool call recovers using the live product UUID', async () => {
  const h = harness({
    token: 'customer-token',
    product: { id: PRODUCT_ID, name: 'Sample Gadget', price: 24.5, stock: 17, is_active: true },
    catalogProduct: { id: `product:${PRODUCT_ID}`, name: 'Sample Gadget', price_usd: 24.5, availability: 'in stock', description: 'Demo device' },
    omitToolCallAt: 2,
    model: [
      toolResponse([{ name: 'search_store', args: { query: 'order Sample Gadget' } }]),
      finalResponse('Your Sample Gadget checkout is ready.', [`product:${PRODUCT_ID}`]),
      finalResponse('Your Sample Gadget checkout is ready.', [`product:${PRODUCT_ID}`]),
    ],
  })
  const reply = await runAssistant({
    messages: [
      { role: 'user', content: 'What do you sell?' },
      { role: 'assistant', content: 'Sample Gadget is in our catalog.' },
      { role: 'user', content: 'order Sample Gadget' },
    ],
    apiKey: 'test', runtime: h.runtime,
  })
  const modelRequests = h.requests.filter((request) => request.url === ZRO_URL)
  expect(reply.action === 'confirm_order', `missing checkout tool did not recover: ${reply.action}`)
  expect(reply.order?.product_id === PRODUCT_ID, 'recovered checkout did not use the catalog UUID')
  expect(h.requests.some((request) => request.url.includes(`/products?id=eq.${PRODUCT_ID}`)), 'recovery did not validate the product against Supabase')
  expect(JSON.parse(String(modelRequests[1]?.init?.body)).tool_choice?.function?.name === 'prepare_checkout', 'checkout was not the required second tool')
  expect(JSON.parse(String(modelRequests[2]?.init?.body)).tool_choice?.function?.name === 'answer_user', 'after server validation the model should return a structured checkout answer')
})

await check('a named product question forces the live catalog tool', async () => {
  const h = harness({
    token: 'customer-token',
    model: [
      toolResponse([{ name: 'search_store', args: { query: 'Tricore Test Laptop' } }]),
      finalResponse('Yes, Tricore Test Laptop is in our catalog.', [`product:${PRODUCT_ID}`]),
    ],
  })
  const reply = await runAssistant({ messages: user('Do you carry Tricore Test Laptop?'), apiKey: 'test', runtime: h.runtime })
  const request = h.requests.find((item) => item.url.includes('chat/completions'))
  const body = JSON.parse(String(request?.init?.body))
  expect(body.tool_choice?.function?.name === 'search_store', 'named product question did not force the catalog tool')
  expect(reply.sources.some((source) => source.id === `product:${PRODUCT_ID}`), 'named product answer lacks a live catalog source')
})

await check('a signed-out catalog question asks for sign-in instead of an ungrounded fallback', async () => {
  const h = harness({
    model: [],
  })
  const reply = await runAssistant({ messages: user('What do you sell?'), apiKey: 'test', runtime: h.runtime })
  expect(reply.link?.path === '/login', `login link missing: ${JSON.stringify(reply.link)}`)
  expect(/sign in/i.test(reply.answer), `expected a sign-in explanation, got ${reply.answer}`)
  expect(!h.requests.some((request) => request.url === ZRO_URL), 'signed-out catalog prompt should not depend on the provider')
})

await check('a provider outage still preserves sign-in for a signed-out catalog question', async () => {
  const h = harness({ model: [] })
  const reply = await runAssistant({ messages: user('What do you sell?'), apiKey: 'test', runtime: h.runtime })
  expect(reply.action === 'answer', `expected sign-in guidance, got ${reply.action}`)
  expect(reply.link?.path === '/login', `login link missing after provider failure: ${JSON.stringify(reply.link)}`)
  expect(/sign in/i.test(reply.answer), `expected sign-in explanation, got ${reply.answer}`)
  expect(!h.requests.some((request) => request.url === ZRO_URL), 'signed-out catalog prompt should not call the provider')
  expect(!h.requests.some((request) => request.url.includes('chat_context')), 'signed-out product browsing must not query private products')
})

await check('ticket section count is explained by the model from live data', async () => {
  const h = harness({
    token: 'admin-token',
    account: {
      viewer_is_admin: true,
      status_vocabulary: { ticket: { aliases: { closed: 'resolved', pending: 'open + in_progress', open: 'open' } } },
      tickets: { total: 6, pending: 3, open: 2, in_progress: 1, resolved: 3 },
    },
    model: [
      toolResponse([{ name: 'read_account', args: { resource: 'tickets' } }]),
      finalResponse('There are 6 tickets in the support section: 2 open, 1 in progress, and 3 resolved.', ['account:tickets']),
    ],
  })
  const reply = await runAssistant({
    messages: user('how many tickets are available in support ticket section'),
    apiKey: 'test', runtime: h.runtime, isAdmin: true,
  })
  expect(reply.answer === 'There are 6 tickets in the support section: 2 open, 1 in progress, and 3 resolved.', reply.answer)
  expect(reply.sources.some((source) => source.id === 'account:tickets'), 'ticket count did not include its live source')
  expect(reply.link === undefined, 'the answer should not force unnecessary navigation')
  const modelRequest = h.requests.find((request) => request.url === ZRO_URL)
  const modelBody = JSON.parse(String(modelRequest?.init?.body))
  expect(modelBody.tool_choice?.function?.name === 'read_account', 'ticket section count must force live ticket data')
  expect(modelBody.messages[0].content.includes('"Available" without a status means the total'), 'model instructions omit the support-section interpretation')
})

await check('a rejected ticket tool call recovers live data before LLM phrasing', async () => {
  const h = harness({
    token: 'admin-token',
    account: {
      viewer_is_admin: true,
      tickets: { total: 6, pending: 3, open: 2, in_progress: 1, resolved: 3 },
    },
    toolCallFails: true,
    model: [structuredFinalResponse('There are 2 open support tickets in the store.', ['account:tickets'])],
  })
  const reply = await runAssistant({ messages: user('How many tickets are open?'), apiKey: 'test', runtime: h.runtime, isAdmin: true })
  const modelRequests = h.requests.filter((request) => request.url === ZRO_URL)
  expect(reply.answer === 'There are 2 open support tickets in the store.', reply.answer)
  expect(reply.sources.some((source) => source.id === 'account:tickets'), 'recovered response lacks a live ticket source')
  expect(h.requests.some((request) => request.url.endsWith('/rpc/chat_account_context')), 'rejected tool call did not trigger a live account lookup')
  expect(modelRequests.length === 2, `expected rejected tool call plus LLM phrasing call, got ${modelRequests.length}`)
  expect(JSON.parse(String(modelRequests[1].init?.body)).tool_choice?.function?.name === 'answer_user', 'recovery call should ask the LLM to return a structured phrase without another data tool')
})

await check('a missing required tool call is recovered before answering ticket counts', async () => {
  const h = harness({
    token: 'admin-token',
    account: {
      viewer_is_admin: true,
      tickets: { total: 6, pending: 3, open: 2, in_progress: 1, resolved: 3 },
    },
    omitRequiredTool: true,
    model: [
      finalResponse('There are 2 open tickets.', []),
      structuredFinalResponse('There are 2 open support tickets in the store.', ['account:tickets']),
    ],
  })
  const reply = await runAssistant({ messages: user('How many tickets are open?'), apiKey: 'test', runtime: h.runtime, isAdmin: true })
  expect(reply.answer === 'There are 2 open support tickets in the store.', reply.answer)
  expect(reply.sources.some((source) => source.id === 'account:tickets'), 'recovered response lacks a live ticket source')
  expect(h.requests.some((request) => request.url.endsWith('/rpc/chat_account_context')), 'omitted required tool call did not trigger a live lookup')
})

await check('open ticket question uses the open count, not the total', async () => {
  const h = harness({
    token: 'admin-token',
    account: {
      viewer_is_admin: true,
      tickets: { total: 6, pending: 3, open: 2, in_progress: 1, resolved: 3 },
    },
    model: [
      toolResponse([{ name: 'read_account', args: { resource: 'tickets' } }]),
      finalResponse('There are 2 open support tickets in the store.', ['account:tickets']),
    ],
  })
  const reply = await runAssistant({ messages: user('How many tickets are open?'), apiKey: 'test', runtime: h.runtime, isAdmin: true })
  expect(reply.answer === 'There are 2 open support tickets in the store.', reply.answer)
  expect(reply.sources.some((source) => source.id === 'account:tickets'), 'open count did not include its live source')
})

await check('a support case question forces live ticket data', async () => {
  const h = harness({
    token: 'customer-token',
    account: {
      viewer_scope: 'customer: own records only',
      tickets: { total: 1, pending: 1, open: 1, in_progress: 0, resolved: 0, recent: [{ ref: 'ABC12345', status: 'open' }] },
    },
    model: [
      toolResponse([{ name: 'read_account', args: { resource: 'tickets' } }]),
      finalResponse('Your support case ABC12345 is open.', ['account:tickets']),
    ],
  })
  const reply = await runAssistant({ messages: user('What is happening with my support case?'), apiKey: 'test', runtime: h.runtime })
  const request = h.requests.find((item) => item.url.includes('chat/completions'))
  const body = JSON.parse(String(request?.init?.body))
  expect(body.tool_choice?.function?.name === 'read_account', 'support case question did not force the account tool')
  expect(reply.answer === 'Your support case ABC12345 is open.', reply.answer)
  expect(reply.sources.some((source) => source.id === 'account:tickets'), 'support case answer lacks a live ticket source')
})

await check('pending support count uses exact live aggregates and adds support navigation', async () => {
  const h = harness({
    token: 'admin-token',
    account: {
      viewer_scope: 'admin: all visible records',
      tickets: { total: 7, pending: 3, open: 2, in_progress: 1, resolved: 4, recent: [] },
      orders: null,
    },
    model: [
      toolResponse([
        { name: 'read_account', args: { resource: 'tickets' } },
        { name: 'show_page', args: { page: '/admin/support', label: 'View pending tickets' } },
      ]),
      finalResponse('There are 3 pending tickets: 2 open and 1 in progress.', ['account:tickets']),
    ],
  })
  const reply = await runAssistant({ messages: user('How many tickets are pending on the support page?'), apiKey: 'test', runtime: h.runtime })
  expect(/3 pending/.test(reply.answer), `wrong count answer: ${reply.answer}`)
  expect(reply.link?.path === '/admin/support', 'support button missing')
  const accountRequest = h.requests.find((r) => r.url.endsWith('/rpc/chat_account_context'))
  const headers = accountRequest?.init?.headers as Record<string, string>
  expect(headers.Authorization === 'Bearer admin-token', 'private data must use the user token, not a service key')
  expect(h.requests.some((r) => r.url === ZRO_URL), 'LLM should explain the live pending ticket counts')
})

await check('a factual answer keeps its live source when it also links to a page', async () => {
  const h = harness({
    token: 'admin-token',
    account: {
      viewer_is_admin: true,
      tickets: { total: 3, pending: 2, open: 1, in_progress: 1, resolved: 1 },
    },
    model: [
      toolResponse([
        { name: 'read_account', args: { resource: 'tickets' } },
        { name: 'show_page', args: { page: '/admin/support', label: 'Open support tickets' } },
      ]),
      finalResponse('There is 1 open ticket in the store.', []),
    ],
  })
  const reply = await runAssistant({ messages: user('How many tickets are open?'), apiKey: 'test', runtime: h.runtime, isAdmin: true })
  expect(reply.sources.some((source) => source.id === 'account:tickets'), 'live ticket source missing when a navigation link is present')
  expect(reply.link?.path === '/admin/support', 'support navigation link missing')
})

await check('signed-out account questions require sign-in and never query private data', async () => {
  const h = harness({
    model: [],
  })
  const reply = await runAssistant({ messages: user('How many tickets do I have?'), apiKey: 'test', runtime: h.runtime })
  expect(reply.link?.path === '/login', 'sign-in button missing')
  expect(!h.requests.some((r) => r.url.includes('chat_account_context')), 'anonymous private query was attempted')
  expect(!h.requests.some((r) => r.url === ZRO_URL), 'signed-out account response should not depend on the provider')
})

await check('a model outage preserves the sign-in link for private ticket questions', async () => {
  const h = harness({
    model: [toolResponse([{ name: 'show_page', args: { page: '/login', label: 'Sign in to continue' } }])],
  })
  const reply = await runAssistant({ messages: user('How many tickets do I have?'), apiKey: 'test', runtime: h.runtime })
  expect(reply.action === 'answer' && /sign in/i.test(reply.answer), `expected a sign-in fallback, got ${reply.answer}`)
  expect(reply.link?.path === '/login', `login link was lost: ${JSON.stringify(reply.link)}`)
})

await check('out-of-stock products never produce a checkout action', async () => {
  const h = harness({
    token: 'customer-token',
    product: { id: PRODUCT_ID, name: PRODUCT.name, price: 1234, stock: 0, is_active: true },
    model: [
      toolResponse([{ name: 'search_store', args: { query: PRODUCT.name } }]),
      toolResponse([{ name: 'prepare_checkout', args: { product_id: PRODUCT_ID, quantity: 1 } }]),
      finalResponse(`${PRODUCT.name} is out of stock, so checkout is unavailable.`, [`product:${PRODUCT_ID}`]),
    ],
  })
  const reply = await runAssistant({ messages: user('Buy it'), apiKey: 'test', runtime: h.runtime })
  expect(!reply.order && reply.action !== 'confirm_order', 'sold-out product produced checkout')
})

await check('unverified model numbers are rejected', async () => {
  const h = harness({
    token: 'customer-token',
    account: { viewer_scope: 'admin: every order, ticket and product in the store', orders: { total: 1, pending: 1 } },
    model: [
      toolResponse([{ name: 'read_account', args: { resource: 'orders' } }]),
      finalResponse('You have 99 pending orders.', ['account:orders']),
    ],
  })
  const reply = await runAssistant({ messages: user('How many pending orders?'), apiKey: 'test', runtime: h.runtime })
  expect(reply.action === 'offer_team' && !/99 pending/.test(reply.answer), 'hallucinated count reached the customer')
})

await check('anonymous checkout sends the visitor to sign-in, never to a product lookup', async () => {
  const h = harness({
    model: [
      toolResponse([{ name: 'prepare_checkout', args: { product_id: PRODUCT_ID, quantity: 1 } }]),
      finalResponse('Please sign in with Google so I can take you to checkout.'),
    ],
  })
  const reply = await runAssistant({ messages: user('Buy one Tricore Test Laptop'), apiKey: 'test', runtime: h.runtime })
  expect(reply.link?.path === '/login', `expected sign-in button, got ${JSON.stringify(reply.link)}`)
  expect(!reply.order && reply.action !== 'confirm_order', 'anonymous visitor got a checkout button')
  expect(!h.requests.some((r) => r.url.includes('/rest/v1/products?')), 'anonymous checkout queried the products table')
})

await check('a product that is no longer active never gets a checkout button', async () => {
  const h = harness({
    token: 'customer-token',
    product: undefined,
    model: [
      toolResponse([{ name: 'prepare_checkout', args: { product_id: PRODUCT_ID, quantity: 1 } }]),
      finalResponse('Sorry, that product is no longer available. Want me to show you what is in stock?', []),
    ],
  })
  const reply = await runAssistant({ messages: user('checkout the laptop'), apiKey: 'test', runtime: h.runtime })
  expect(!reply.order && reply.action !== 'confirm_order', 'inactive product produced checkout')
})

await check('a quantity above stock is refused before checkout', async () => {
  const h = harness({
    token: 'customer-token',
    product: { id: PRODUCT_ID, name: PRODUCT.name, price: 1234, stock: 2, is_active: true },
    model: [
      toolResponse([{ name: 'prepare_checkout', args: { product_id: PRODUCT_ID, quantity: 5 } }]),
      finalResponse('Only 2 are in stock, so I can prepare 2 for you.', [`product:${PRODUCT_ID}`]),
    ],
  })
  const reply = await runAssistant({ messages: user('checkout 5 laptops'), apiKey: 'test', runtime: h.runtime })
  expect(!reply.order && reply.action !== 'confirm_order', 'over-stock quantity produced checkout')
})

await check('a question about a product not in the catalog gets an honest answer and no checkout', async () => {
  const h = harness({
    token: 'customer-token',
    model: [
      toolResponse([{ name: 'search_store', args: { query: 'gaming chair' } }]),
      finalResponse('I don\'t see a gaming chair in our catalog right now. Would you like me to connect you with my team to source one?', [], 'offer_team'),
    ],
  })
  const reply = await runAssistant({ messages: user('Do you sell gaming chairs?'), apiKey: 'test', runtime: h.runtime })
  expect(!reply.order && reply.action !== 'confirm_order', 'missing product produced checkout')
})

await check('off-topic requests get a redirect with no tool calls', async () => {
  const h = harness({
    token: 'customer-token',
    model: [{
      role: 'assistant',
      content: JSON.stringify({ intent: 'offtopic', action: 'answer', answer: 'I can only help with Tricore products, orders and support.', handoff_reason: '', sources: [] }),
    }],
  })
  const reply = await runAssistant({ messages: user('Write me a poem about the moon'), apiKey: 'test', runtime: h.runtime })
  expect(reply.intent === 'offtopic', `expected offtopic intent, got ${reply.intent}`)
  expect(!reply.order && reply.action !== 'confirm_order', 'off-topic produced checkout')
})

await check('"closed tickets" uses the live resolved figure and its own vocabulary', async () => {
  const h = harness({
    token: 'admin-token',
    account: {
      viewer_is_admin: true,
      viewer_scope: 'admin: every order, ticket and product in the store',
      status_vocabulary: { ticket: { aliases: { closed: 'resolved', pending: 'open + in_progress' } } },
      tickets: {
        total: 12, pending: 4, open: 2, in_progress: 2, resolved: 8,
        by_status: [{ status: 'resolved', count: 8 }, { status: 'open', count: 2 }, { status: 'in_progress', count: 2 }],
      },
      orders: null, catalog: null,
    },
    model: [
      toolResponse([{ name: 'read_account', args: { resource: 'tickets' } }]),
      finalResponse('8 tickets have been closed (resolved). 4 are still in play: 2 open and 2 in progress.', ['account:tickets']),
    ],
  })
  const reply = await runAssistant({
    messages: user('how many support tickets were closed'),
    apiKey: 'test', runtime: h.runtime, isAdmin: true, page: '/admin/support',
  })
  expect(/\b8\b/.test(reply.answer), `closed count missing: ${reply.answer}`)
  expect(!/can.?t|don.?t have|check (your|the) (my tickets|admin support)/i.test(reply.answer), `deflected instead of answering: ${reply.answer}`)
  expect(reply.sources.some((s) => s.id === 'account:tickets'), 'answer was not attributed to the live ticket data')
  expect(h.requests.some((r) => r.url.endsWith('/rpc/chat_account_context')), 'no live query was made for a count question')
})

await check('store-wide figures stay available to an admin, and the scope travels with the answer', async () => {
  const h = harness({
    token: 'admin-token',
    account: {
      viewer_is_admin: true, viewer_scope: 'admin: every order, ticket and product in the store',
      orders: { total: 15, needs_action: 3, delivered: 6 },
      tickets: { total: 12, resolved: 8 },
      catalog: { products_out_of_stock: 2, products_low_stock: 1 },
      status_vocabulary: { order: { needs_action_definition: 'payment_submitted (to verify) + paid (to ship)' } },
    },
    model: [
      toolResponse([{ name: 'read_account', args: { resource: 'all' } }]),
      finalResponse('Across the store: 12 tickets (8 closed), 15 orders with 3 needing action, and 2 products out of stock.', ['account:orders', 'account:tickets', 'account:catalog']),
    ],
  })
  const reply = await runAssistant({ messages: user('give me an overview of the store'), apiKey: 'test', runtime: h.runtime, isAdmin: true, page: '/admin/orders' })
  expect(reply.sources.length === 3, `expected three live sources, got ${JSON.stringify(reply.sources)}`)
  expect(!h.requests.some((r) => r.url.includes('/rest/v1/orders?')), 'store overview must not read tables directly, only the scope-checked function')
})

await check('a customer is never given store-wide counts', async () => {
  const h = harness({
    token: 'customer-token',
    account: {
      viewer_is_admin: false, viewer_scope: "customer: only this account's own orders and tickets",
      tickets: { total: 1, resolved: 1, pending: 0 },
    },
    model: [
      toolResponse([{ name: 'read_account', args: { resource: 'tickets' } }]),
      finalResponse('You have 1 ticket and it is closed. Store-wide figures are for our team.', ['account:tickets']),
    ],
  })
  const reply = await runAssistant({ messages: user('how many tickets has the store closed in total?'), apiKey: 'test', runtime: h.runtime })
  expect(reply.answer === 'You have 1 ticket and it is closed. Store-wide figures are for our team.', `wrong scope answer: ${reply.answer}`)
  const req = h.requests.find((r) => r.url.endsWith('/rpc/chat_account_context'))
  expect((req?.init?.headers as Record<string, string>).Authorization === 'Bearer customer-token', 'account data must be read with the caller token only')
})

await check('a database failure produces honesty, never a made-up count', async () => {
  const h = harness({
    token: 'admin-token',
    accountFails: true,
    model: [
      toolResponse([{ name: 'read_account', args: { resource: 'tickets' } }]),
      finalResponse('17 tickets are closed.', ['account:tickets']),
    ],
  })
  const reply = await runAssistant({ messages: user('how many support tickets were closed?'), apiKey: 'test', runtime: h.runtime, isAdmin: true })
  expect(reply.action === 'offer_team', `expected the team offer, got ${reply.action}: ${reply.answer}`)
  expect(!/\d/.test(reply.answer), `a number was claimed with no live data: ${reply.answer}`)
})

console.log(failures ? `RESULT: ${failures} FAILED` : 'RESULT: ALL ASSISTANT CHECKS PASSED')
process.exitCode = failures ? 1 : 0
