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

// One file to paste into the Supabase SQL editor: chatbot tables, context functions and the knowledge base seed.
const read = (n) => readFileSync(new URL(`../../supabase/migrations/${n}`, import.meta.url), 'utf8')
writeFileSync(
  new URL('../../supabase/chatbot-setup.sql', import.meta.url),
  [
    read('20261010000000_chatbot.sql'),
    read('20261010010000_chat_context_v2.sql'),
    read('20261105000000_chat_assistant.sql'),
    read('20261106000000_chat_account_insights.sql'),
    sql,
  ].join('\n\n'),
)
console.log('Wrote chatbot-setup.sql')
