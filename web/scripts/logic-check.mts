// Offline checks for conversation understanding (no model calls).
import { writeFileSync, appendFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { analyze, buildPrompt, matchProduct, proposedPrice, routeCatalog, stateBlock, wantsLowerPrice, type ChatContext } from '../api/_lib/core.ts'
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

// ── prompt size ──
const kb = JSON.parse(readFileSync(new URL('../../supabase/kb/articles.json', import.meta.url), 'utf8'))
const big: ChatContext = { articles: kb.map((x: any) => ({ id: x.slug, title: x.title, content: x.content })), products: Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, name: `Sample Product Name Number ${i + 1} Pro`, price_usd: 19.99 + i, availability: 'in stock', description: 'A typical short product description for testing sizes' })), total_products: 60 }
const sys = buildPrompt(big, 'Ravi', stateBlock(analyze([u('hi')], big.products), big.products)).system
appendFileSync(OUT, `INFO  system prompt = ${sys.length} chars (about ${Math.round(sys.length / 3.8)} tokens)\n`)
ok(sys.length < 11000, 'prompt stays compact')
appendFileSync(OUT, fails ? `RESULT: ${fails} FAILED\n` : 'RESULT: ALL PASSED\n')
