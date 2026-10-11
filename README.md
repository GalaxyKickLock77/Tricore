# Tricore Store

React (Vite + TypeScript + Tailwind) served by Nginx in Docker, backed by Supabase Cloud (Auth, Postgres, RLS).

## Setup
1. **Database:** in the Supabase dashboard open SQL Editor and run `supabase/migrations/20261009000000_init_store.sql`
   (or use the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`).
2. **Auth (Google only):**
   - Google Cloud Console → Credentials → create an OAuth client (Web). Authorized redirect URI:
     `https://<project-ref>.supabase.co/auth/v1/callback`. Publish the consent screen before going live.
   - Supabase → Authentication → Sign In / Providers → Google: enable it and paste the Client ID and Secret.
   - Supabase → Authentication → URL Configuration: set Site URL to your deployed URL and add
     `<your-url>/**` and `http://localhost:5173/**` under Redirect URLs.
   - Email/password sign-in is not used by the app. You can switch the Email provider off.
3. **Env:** copy `.env.example` to `.env` (repo root, for Docker) or `web/.env.local` (for `npm run dev`). Use the
   **publishable** key only. Never put the secret/service_role key in the frontend.
4. **Run:** `docker compose up --build` → http://localhost:8080  (or `cd web && npm install && npm run dev`).
5. **First admin:** sign in with Google once, then run `supabase/promote-admin.sql` in the SQL editor with that Google email.
   Admin role cannot be self-assigned from the browser.

## CI/CD (GitHub Actions, `.github/workflows/ci.yml`)
- PRs and main: install, type-check, build.
- main: build and push image to `ghcr.io/<owner>/<repo>/web`, then `supabase db push` for migrations.
- Configure repo **variables** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and in the `production`
  environment: variable `SUPABASE_PROJECT_REF`, secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`.

## AI assistant (chat widget)
- **Where:** floating chat button on every page. Backend: `web/api/chat.ts` (Vercel serverless function) calling Groq
  (`openai/gpt-oss-120b`, falling back to `qwen/qwen3.8-27b` then `openai/gpt-oss-20b`; all on Groq's free tier).
- **RAG:** the function calls the Supabase RPC `chat_context()`, which returns relevant knowledge articles
  (`kb_articles`, Postgres full-text search; articles with category `core` are always included) plus the live product list.
  The model may only answer from that context.
- **Accuracy checks (code, not just the prompt):** the reply must cite sources that exist in the retrieved context, and
  every price/number in the answer must appear in the context. Otherwise the bot hands the customer to the team.
- **Human routing (ask first):** the assistant talks like a friendly shop assistant and answers from the knowledge base.
  It cannot change prices, so when a customer wants a lower price, discount, coupon, bulk or special deal, it says so and
  asks "Would you like me to connect you with my team?" (Yes / No buttons). Only a "yes", or an explicit request for a
  person, opens the contact form, which creates a row in `support_requests` (admin page: **Support**).
  Payment, delivery, returns and warranty questions are answered honestly from the knowledge base (the team confirms
  these after the order); the bot never invents them. Unrelated questions get a short friendly redirect.
- **Setup:**
  1. Fresh install: run `supabase/chatbot-setup.sql` in the Supabase SQL editor (chatbot migration + v2 + knowledge base).
     Already installed the first version? Just run `supabase/migrations/20261010010000_chat_context_v2.sql`.
  2. Set `GROQ_API_KEY` in Vercel (Production + Preview, type Sensitive). Never commit it or use a `VITE_` prefix.
  3. Edit the knowledge base: Supabase Table Editor, `kb_articles` (or edit `supabase/kb/articles.json`,
     run `node web/scripts/gen-kb-sql.mjs`, and run the generated `supabase/seed_kb.sql`).
- **Evaluate:** from `web/`: `node --env-file=.env.local scripts/eval-chat.mts` (22 questions against the real model).
