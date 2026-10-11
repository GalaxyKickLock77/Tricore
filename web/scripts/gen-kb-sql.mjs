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
