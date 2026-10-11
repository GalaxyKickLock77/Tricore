// Offline checks for conversation understanding (no model calls).
import { writeFileSync, appendFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { analyze, buildPrompt, matchProduct, parseQuantity, proposedPrice, routeCatalog, routeOrder, routeOrders, stateBlock, wantsLowerPrice, wantsOrderStatus, type ChatContext } from '../api/_lib/core.ts'
const OUT = new URL('../logic-out.txt', import.meta.url)
writeFileSync(OUT, '')
let fails = 0
const ok = (c: boolean, m: string) => { appendFileSync(OUT, (c ? 'PASS  ' : 'FAIL  ') + m + '\n'); if (!c) fails++ }
const P = (id: string, name: string, price: number, av: string) => ({ id, name, price_usd: price, availability: av, description: '' })
const products = [
  P('1', 'Test', 100, 'out of stock'),
  P('2', 'Dell Latitude 5440 Laptop', 899, 'in stock'),
  P('3', 'HP ProBook 450 G10 Laptop', 749, 'in stock'),
  P('4', 'Hikvision 4MP CCTV Camera', 59.99, 'out of stock'),
  P('5', 'APC 1100VA UPS', 139, 'in stock'),
  P('6', 'TP-Link 24-port Gigabit Switch', 129.5, 'low stock'),
]
const u = (content: string) => ({ role: 'user' as const, content })
const a = (content: string) => ({ role: 'assistant' as const, content })

ok(matchProduct('can I get Test for 80$', products)?.name === 'Test', 'matches "Test"')
ok(matchProduct('do you have the ups?', products)?.name === 'APC 1100VA UPS', 'matches UPS by unique word')
ok(matchProduct('price of the camera', products)?.name.startsWith('Hikvision') === true, 'matches camera by unique word')
ok(matchProduct('which laptop is good', products) === null, 'ambiguous "laptop" -> no match')
ok(matchProduct('hello there', products) === null, 'no match for chit-chat')
ok(matchProduct('Dell Latitude 5440', products)?.name.startsWith('Dell') === true, 'matches by partial name')

ok(proposedPrice('can you give it for 80$') === 80, 'price: "for 80$"')
ok(proposedPrice('$80 please') === 80, 'price: "$80"')
ok(proposedPrice('80 dollars?') === 80, 'price: "80 dollars"')
ok(proposedPrice('can you do 600') === 600, 'price: "do 600"')
ok(proposedPrice('what is available under $50?') === null, 'search "under $50" is not haggling')
ok(proposedPrice('I want 3 laptops for 3 people') === null, 'quantities are not prices')

ok(wantsLowerPrice('can you give discount') && wantsLowerPrice('too expensive') && !wantsLowerPrice('Do you offer installation service?'), 'lower-price detector')

// the scenario from the bug report
let f = analyze([u('what is the test product'), a('Test is listed at $100.00 and is out of stock.'), u('can I get it for 80$?')], products)
ok(f.product?.name === 'Test' && f.proposed === 80 && !f.explicit, 'follow-up "it for 80$" keeps focus on Test (out of stock), proposed 80')
f = analyze([u('can I get Test for $80')], products)
ok(f.product?.name === 'Test' && f.explicit && f.proposed === 80, 'single message names Test and price')
// memory beyond the window
f = analyze([u('what is the cheapest switch'), a('The TP-Link 24-port Gigabit Switch is $129.50.'), u('and can I buy the earlier one?')], products, ['Hikvision 4MP CCTV Camera'])
ok(f.discussed.includes('Hikvision 4MP CCTV Camera') && f.discussed.includes('TP-Link 24-port Gigabit Switch'), 'memory keeps earlier products: ' + f.discussed.join(' | '))
f = analyze([u('hi')], products, ['APC 1100VA UPS'])
ok(f.product?.name === 'APC 1100VA UPS', 'memory restores focus when chat window is empty of products')

// ── direct (no-model) catalog answers ──
const ctx: ChatContext = { articles: [], products, total_products: products.length }
const route = (msgs: { role: 'user' | 'assistant'; content: string }[], memory: string[] = []) => routeCatalog(msgs, ctx, analyze(msgs, products, memory))
let r = route([u('what is the test product'), a('Test is listed at $100.00 and is out of stock.'), u('can I get it for 80$?')])
ok(r?.action === 'offer_team' && /out of stock/i.test(r.answer) && /\?\s*$/.test(r.answer) && !/good deal/i.test(r.answer), 'BUG SCENARIO: out-of-stock + lower price -> says out of stock first, asks about team: ' + r?.answer)
r = route([u('can I get Test for $80')])
ok(r?.action === 'offer_team' && /out of stock/i.test(r.answer), 'single message out-of-stock + price')
r = route([u('price of HP ProBook?'), a('The HP ProBook 450 G10 Laptop is $749.00.'), u('can you do 600?')])
ok(r?.action === 'offer_team' && /749/.test(r.answer) && /600/.test(r.answer) && /team/i.test(r.answer), 'in stock + lower price -> mentions both prices, asks about team: ' + r?.answer)
r = route([u('is Test available?')])
ok(r?.action === 'answer' && /out of stock/i.test(r.answer) && !/connect you/i.test(r.answer), 'availability of out-of-stock item -> plain answer with alternatives: ' + r?.answer)
r = route([u('is the UPS available?')])
ok(r?.action === 'answer' && /in stock/i.test(r.answer) && /139/.test(r.answer), 'availability of in-stock item: ' + r?.answer)
r = route([u('what about the switch'), a('The TP-Link 24-port Gigabit Switch is $129.50.'), u('is it available?')])
ok(r?.action === 'answer' && /only a few|129/.test(r.answer), 'pronoun follow-up uses the earlier product: ' + r?.answer)
r = route([u('how much is the camera?')])
ok(r?.action === 'answer' && /out of stock/i.test(r.answer), 'price question on out-of-stock product mentions stock')
r = route([u('which is your cheapest item?')])
ok(r?.action === 'answer' && /\$29\.99|APC|139|Dell|HP|TP-Link|Test|Hikvision/.test(r.answer) && !/Test /.test(r.answer.replace('Test is','')), 'cheapest item is chosen among in-stock products: ' + r?.answer)
r = route([u('do you have laptops?'), a('We have Dell and HP.'), u('what about monitors?')])
ok(r === null, 'category questions are left to the model')
r = route([u('price of Test'), a('Test is $100.00 but out of stock.'), u('do you have laptops?')])
ok(r === null, 'topic change without pronoun is NOT answered about the old product')
r = route([u('I want 3 UPS units, price?')])
ok(r === null, 'quantity questions go to the model (maths)')

// ── ordering on behalf of the customer ──
type M = { role: 'user' | 'assistant'; content: string }
const ordRoute = (msgs: M[], c: ChatContext = ctx) => { const f = analyze(msgs, products); return routeOrders(msgs, c) ?? routeOrder(msgs, c, f) ?? routeCatalog(msgs, c, f) }
ok(parseQuantity('order 2 of them') === 2, 'qty: "order 2 of them"')
ok(parseQuantity('buy three UPS') === 3, 'qty: words')
ok(parseQuantity('order the Dell Latitude 5440', products[1]) === 1, 'qty: product number 5440 is not a quantity')
ok(parseQuantity('I want to order HP ProBook 450 G10', products[2]) === 1, 'qty: product number 450 is not a quantity')
ok(parseQuantity('order 50 UPS') === 20, 'qty: capped at 20')
ok(parseQuantity('buy it for $80') === 1, 'qty: price is not a quantity')

let o = ordRoute([u('order the APC UPS')])
ok(o?.action === 'confirm_order' && o.order?.product_id === '5' && o.order.quantity === 1 && o.order.unit_price === 139, 'order intent -> confirm_order proposal (not placed)')
o = ordRoute([u('I want to buy 2 UPS')])
ok(o?.action === 'confirm_order' && o.order?.quantity === 2 && /278/.test(o.answer), 'quantity 2 -> total 278: ' + o?.answer)
o = ordRoute([u('is the UPS available?')])
const offerText = o?.answer ?? ''
ok(/place the order for you/i.test(offerText), 'availability reply offers to place the order')
o = ordRoute([u('is the UPS available?'), a(offerText), u('yes please')])
ok(o?.action === 'confirm_order' && o.order?.name === 'APC 1100VA UPS', 'yes after the offer -> confirm_order')
o = ordRoute([u('yes please')])
ok(o === null, 'bare yes without context -> nothing happens')
o = ordRoute([u('order Test')])
ok(o?.action === 'answer' && /out of stock/i.test(o.answer) && !o.order, 'out-of-stock item is never proposed')
o = ordRoute([u('how do I order the UPS?')])
ok(o === null, 'how-to question is left to the model')
o = ordRoute([u('order the UPS for $100')])
ok(o?.action === 'offer_team' && !o.order, 'order + lower price -> price talk first, no order')
o = ordRoute([u('order a laptop')])
ok(o === null, 'ambiguous product -> no order proposal')
o = ordRoute([u('tell me about the UPS'), a('The APC 1100VA UPS is $139.00.'), u('ok order it')])
ok(o?.action === 'confirm_order', '"order it" uses the product in focus')

const withOrders = (orders: ChatContext['orders']): ChatContext => ({ ...ctx, orders })
ok(wantsOrderStatus('where is my order?') && wantsOrderStatus("my order hasn't arrived") && !wantsOrderStatus('How do I check my order?'), 'order-status detector')
o = ordRoute([u('where is my order?')], withOrders(null))
ok(o?.action === 'answer' && /sign/i.test(o.answer), 'signed-out customer is asked to sign in')
o = ordRoute([u('where is my order?')], withOrders([]))
ok(/don't see any orders/i.test(o?.answer ?? ''), 'no orders yet')
o = ordRoute([u('what is the status of my order')], withOrders([{ id: 'a', quantity: 2, unit_price: 139, status: 'shipped', created_at: '2026-10-09T10:00:00Z', products: { name: 'APC 1100VA UPS' } }]))
ok(/shipped/i.test(o?.answer ?? '') && /278/.test(o?.answer ?? ''), 'reports the real status: ' + o?.answer)
o = ordRoute([u('my order has not arrived')], withOrders([{ id: 'a', quantity: 1, unit_price: 139, status: 'pending', created_at: '2026-10-09T10:00:00Z', products: { name: 'APC 1100VA UPS' } }]))
ok(o?.action === 'offer_team' && /pending/i.test(o.answer), 'not-arrived complaint -> status plus offer of the team')

// ── prompt size ──
const kb = JSON.parse(readFileSync(new URL('../../supabase/kb/articles.json', import.meta.url), 'utf8'))
const big: ChatContext = { articles: kb.map((x: any) => ({ id: x.slug, title: x.title, content: x.content })), products: Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, name: `Sample Product Name Number ${i + 1} Pro`, price_usd: 19.99 + i, availability: 'in stock', description: 'A typical short product description for testing sizes' })), total_products: 60 }
const sys = buildPrompt(big, 'Ravi', stateBlock(analyze([u('hi')], big.products), big.products)).system
appendFileSync(OUT, `INFO  system prompt = ${sys.length} chars (about ${Math.round(sys.length / 3.8)} tokens)\n`)
ok(sys.length < 11000, 'prompt stays compact')
appendFileSync(OUT, fails ? `RESULT: ${fails} FAILED\n` : 'RESULT: ALL PASSED\n')
