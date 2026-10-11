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
