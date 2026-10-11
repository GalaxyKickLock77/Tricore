// Generates supabase/seed_kb.sql from supabase/kb/articles.json (source of truth).
// Run: node web/scripts/gen-kb-sql.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const articles = JSON.parse(readFileSync(new URL('../../supabase/kb/articles.json', import.meta.url), 'utf8'))
const q = (s) => `$kb$${s}$kb$`
const rows = articles
  .map((a) => `  (${q(a.slug)}, ${q(a.title)}, ${q(a.content)}, ${q(a.category ?? 'general')})`)
  .join(',\n')

const sql = `-- GENERATED from supabase/kb/articles.json by web/scripts/gen-kb-sql.mjs. Safe to re-run.
insert into public.kb_articles (slug, title, content, category) values
${rows}
on conflict (slug) do update
  set title = excluded.title, content = excluded.content, category = excluded.category, updated_at = now();
`
writeFileSync(new URL('../../supabase/seed_kb.sql', import.meta.url), sql)
console.log(`Wrote seed_kb.sql with ${articles.length} articles`)

// Built-in copy used by /api/chat only when the database is unreachable (so the bot still answers basics).
const fallback = `// GENERATED from supabase/kb/articles.json by web/scripts/gen-kb-sql.mjs. Do not edit by hand.
import type { KbArticle } from './core.js'

export const FALLBACK_ARTICLES: KbArticle[] = ${JSON.stringify(
  articles.filter((a) => a.category === 'core').map((a) => ({ id: a.slug, title: a.title, content: a.content })),
  null,
  2,
)}
`
writeFileSync(new URL('../api/_lib/fallback-kb.ts', import.meta.url), fallback)

// One file to paste into the Supabase SQL editor: migration + knowledge base seed.
const read = (n) => readFileSync(new URL(`../../supabase/migrations/${n}`, import.meta.url), 'utf8')
writeFileSync(
  new URL('../../supabase/chatbot-setup.sql', import.meta.url),
  `${read('20261010000000_chatbot.sql')}\n\n${read('20261010010000_chat_context_v2.sql')}\n\n${sql}`,
)
console.log('Wrote fallback-kb.ts and chatbot-setup.sql')
