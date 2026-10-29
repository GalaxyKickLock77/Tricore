# Tricore Store

There is no online payment on the site: after an order is placed, the Tricore team confirms it and arranges payment with the customer on that order's support ticket.

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
- **Where:** floating chat button on every page. Backend: `web/api/chat.ts` (Vercel serverless function) calling Cline
  (`nvidia/nemotron-3.5-lightning:free`). Logic: `web/api/_lib/assistant.ts`,
  tools in `web/api/_lib/assistant-tools.ts`.
- **Live tools, no memorised facts:** the model answers only from tools that read the database while it is answering:
  `search_store` (knowledge articles from `kb_articles` plus the live product list, through the `chat_context()` RPC),
  `read_account` (live counts, statuses, history and tracking for orders, support tickets and stock, through
  `chat_account_context()`), `prepare_checkout` (validates stock, places nothing) and `show_page` (a navigation button).
  Every database call is made with the signed-in person's own token, so Row Level Security decides the scope: a customer
  gets their own records, an admin gets the whole store. Nothing is looked up in a file of canned answers.
- **Accuracy checks (code, not just the prompt):** a factual answer must cite sources that came back from a tool, and every
  price or number in the reply must appear in the data the tool returned. If either check fails, the assistant says it could
  not verify that and offers the team - it never ships an unverified figure.
- **Wordings the customer uses** ("closed", "completed", "unpaid", "on the way") are mapped onto real status values by
  `assistant_status_vocabulary` in `app_config`. Edit that row in the SQL editor to change the vocabulary; no code change:
  `update public.app_config set value = '<json>' where key = 'assistant_status_vocabulary';`
- **Human routing (ask first):** the assistant talks like a friendly shop assistant and answers from the knowledge base.
  It cannot change prices, so when a customer wants a lower price, discount, coupon, bulk or special deal, it says so and
  asks "Would you like me to connect you with my team?" (Yes / No buttons). Only a "yes", or an explicit request for a
  person, shows the two contact options: **Open a support ticket** (creates a row in `support_requests`, admin page:
  **Support**, with a ticket number) or **Email us** (a mailto link; set `contact.email` in `web/src/config.ts`).
  Payment, delivery, returns and warranty questions are answered honestly from the knowledge base (the team confirms
  these after the order); the bot never invents them. Unrelated questions get a short friendly redirect.
- **Setup:**
  1. Fresh install: run `supabase/chatbot-setup.sql` in the Supabase SQL editor (chat tables, context functions,
     account insight function and knowledge base). Already installed? Run the migrations you are missing, in date order -
     the assistant needs `20261105000000_chat_assistant.sql` and `20261106000000_chat_account_insights.sql`.
  2. Set `CLINE_API_KEY` in Vercel (Production + Preview, type Sensitive). Never commit it or use a `VITE_` prefix.
  3. Edit the knowledge base: the admin **Knowledge** page, or Supabase Table Editor on `kb_articles` (or edit
     `supabase/kb/articles.json`, run `node web/scripts/gen-kb-sql.mjs`, and run the generated `supabase/seed_kb.sql`).
- **Evaluate:** from `web/`: `node scripts/assistant-check.mts` (offline: tools, guardrails and scope, no model call),
  `node scripts/eval-chat.mts` (22 catalogue questions against the real model) and
  `node_modules\.bin\jiti.cmd scripts\live-admin-insights-check.mts` (real admin account: every number the assistant
  quotes is compared with the database, and a signed-out visitor is checked for leaks). These use free-tier tokens.

### Conversation state and capacity
- **Conversation state:** the server keeps the chat plus the product names the browser sends back as `memory`, and the
  tools see live stock. Out-of-stock products are never negotiated: the assistant says so first and suggests in-stock
  alternatives.
- **Store and account questions answered directly:** "how many support tickets were closed", "how many orders need
  shipping", "how many products are out of stock", "what are my recent orders" - all from live figures, for admins
  store-wide and for customers their own.
- **Provider capacity:** the assistant currently uses Cline's free `nvidia/nemotron-3.5-lightning` route. Availability
  and limits are controlled by Cline and the selected model. Public FAQ answers are cached for 15 minutes and small talk
  needs no model call; private or live data is never cached.
- **Checks without the model:** `node scripts/assistant-check.mts` (tool use, scope and guardrails) and
  `node scripts/logic-check.mts` (product matching, price detection, memory) from `web/`.

### What the assistant can and cannot do (access model)
- **Can (read only):** public product list and knowledge base; live counts and status for orders, support tickets and
  stock; the signed-in customer's OWN recent orders and tickets. An admin gets store-wide figures. Every one of these
  reads runs with the visitor's own token, so database rules apply and the server never holds a service key here.
- **Can propose:** an order (product, quantity, total). It appears as a "Confirm your order" card; the order is placed only
  when the customer presses Confirm, using their own signed-in session and the existing `place_order()` function (stock check,
  price snapshot, row level security). A chat message alone can never create an order.
- **Can request:** a call-back from the team (contact form, only after the customer says yes).
- **Cannot:** take payments, change prices or give discounts, cancel or edit orders, close or reopen tickets, see other
  customers' data, use any admin write function, or touch products and stock. Staff status only widens what the read
  functions return; it never grants a write, and the server never holds a service key for the chat.

### Support tickets (comments and updates)
- Run `supabase/migrations/20261011000000_ticket_comments.sql` once in the Supabase SQL editor.
- **Admin** (`/admin/support`): filter by Open / In progress / Resolved, change the status, post updates the customer can
  see, add internal notes only admins can see, read the chat that led to the ticket, and use **Email customer**.
  The first public reply moves an open ticket to In progress.
- **Customer** (`/tickets`, "Support" in the menu, with a New ticket button): sees their own tickets and the team's updates, and can reply. A reply on a
  resolved ticket reopens it. Visitors who were not signed in get no in-app view; admins email them instead.
- Comments can only be added through `add_ticket_comment()`, which checks who may write on which ticket.
- Emails go out through the `/api/notify` endpoint once SMTP is configured (see the automation section below). An order ticket does not send a
  second "new ticket" email, because the order itself already notified you.

## Checkout, payment and shipping
Flow: **Buy** -> checkout (delivery address) -> order placed (stock reserved, a support ticket is opened automatically) -> the team confirms the order and
arranges payment with the customer on that ticket -> admin marks it paid -> admin ships (courier + tracking) -> delivered.
- **Payment is never taken by the website on its own.** The amount and how to pay are agreed between the team and the customer on the order's support
  ticket. Never put a payment app, gateway, UPI ID or QR code into `supabase/kb/articles.json` unless checkout really offers it - the assistant repeats the
  knowledge base as fact.
- **Setup:** run `supabase/migrations/20261012000000_checkout.sql` and `supabase/migrations/20261107000000_kb_payment_copy.sql` (the current chatbot
  knowledge) in the Supabase SQL editor. You can edit any article later in **Admin -> Knowledge** without a deploy.
- **Currency:** Indian rupees. The numbers in your product list are shown as rupees.
- **Statuses:** awaiting_payment, paid, shipped, delivered, cancelled (plus `payment_submitted` on a few older orders). Status changes happen only through
  database functions (`place_order`, `cancel_my_order`, `admin_*`), each with its own permission check and a timeline entry the customer can see on My
  orders. `submit_payment()` belongs to the retired manual-reference flow and no page calls it.
- **Unpaid orders expire:** `expire_unpaid_orders()` cancels them after the "Cancel unpaid orders after" setting (default 24 hours) and returns the stock.
  It runs on pg_cron where available, and from the admin Orders page otherwise.
- **Admin alerts:** an "Orders" badge counts orders that need action (waiting for payment, paid and ready to ship, shipped and to be marked delivered), and
  a live pop-up appears when an order is placed.
- The chat assistant can start an order but never places it: the customer finishes the address on the checkout page.

## Less admin work: automatic cancel, emails and AI help
**One-time setup**
1. Run `supabase/migrations/20261013000000_automation.sql` in the Supabase SQL editor.
2. Emails (optional but recommended). Pick any SMTP account (a Gmail address with an App Password works; so do Brevo, Zoho or Resend SMTP) and add these
   Vercel environment variables (Production): `SMTP_HOST` (Gmail: `smtp.gmail.com`), `SMTP_PORT` (`465`), `SMTP_USER`, `SMTP_PASS`,
   optionally `MAIL_FROM` (for example `Tricore IT Solutions <you@gmail.com>`). Then create the shared secret in the SQL editor:
   `update public.app_config set value = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') where key = 'notify_secret' returning value;`
   Copy the value it shows into a Vercel variable named `NOTIFY_SECRET`, and run:
   `update public.app_config set value = 'https://YOUR-SITE/api/notify' where key = 'notify_url';`
   Redeploy after adding variables. Make sure the `pg_net` extension is on (Supabase: Database, Extensions).
3. In the app (admin), open **Settings** and enter your support email and the hours after which unpaid orders are cancelled.

**What runs automatically**
- Unpaid orders are cancelled after the chosen hours, with the stock returned (every 30 minutes through `pg_cron` when enabled;
  otherwise whenever an admin opens Orders).
- Emails: customers get order placed, payment received or rejected, shipped (with tracking), delivered and cancelled; ticket opened
  and every team reply (also for visitors who were not signed in, using the email they gave). Admins get new orders, payments to
  verify, new tickets and customer replies. Internal notes are never emailed.
- Admin **Support tickets**: "Suggest reply" writes a draft you edit before posting; "Summarise" adds a one-line summary,
  category and priority and puts urgent tickets first; "Turn into a knowledge article" drafts an FAQ from a resolved ticket
  (personal details removed) that you review and save. The AI never sends or decides anything on its own.
- Admin **Knowledge** page: edit what the chat assistant knows.
- Checks: `node --import ./scripts/ts-resolve.mjs scripts/mail-check.mts` (emails and endpoint security) and
  `scripts/ai-check.mts` (AI helpers; makes a few real model calls) from `web/`.

### Ticket updates the customer sees and gets by email
Run `supabase/migrations/20261014000000_ticket_updates.sql` once.
- Every status change is written into the ticket thread ("Status changed to Resolved"), visible to the customer on the Support page.
- A team reply emails the customer the message plus the ticket status. Changing the status on its own (Open, In progress, Resolved)
  also emails the customer. A reply that moves the status sends one email, not two.
- The customer's **Support** menu shows a red count of tickets with new replies, a live pop-up when the team replies, and a
  "New reply" tag on those tickets until they have been viewed.
