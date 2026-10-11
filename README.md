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
  person, shows the two contact options: **Open a support ticket** (creates a row in `support_requests`, admin page:
  **Support**, with a ticket number) or **Email us** (a mailto link; set `contact.email` in `web/src/config.ts`).
  Payment, delivery, returns and warranty questions are answered honestly from the knowledge base (the team confirms
  these after the order); the bot never invents them. Unrelated questions get a short friendly redirect.
- **Setup:**
  1. Fresh install: run `supabase/chatbot-setup.sql` in the Supabase SQL editor (chatbot migration + v2 + knowledge base).
     Already installed the first version? Just run `supabase/migrations/20261010010000_chat_context_v2.sql`.
  2. Set `GROQ_API_KEY` in Vercel (Production + Preview, type Sensitive). Never commit it or use a `VITE_` prefix.
  3. Edit the knowledge base: Supabase Table Editor, `kb_articles` (or edit `supabase/kb/articles.json`,
     run `node web/scripts/gen-kb-sql.mjs`, and run the generated `supabase/seed_kb.sql`).
- **Evaluate:** from `web/`: `node --env-file=.env.local scripts/eval-chat.mts` (22 questions against the real model).

### Chat memory, stock awareness and capacity
- **Conversation state:** for every message the server works out which product is being discussed (from the whole chat plus
  the product names the browser sends back as `memory`), its stock, and any price the customer proposes. Out-of-stock
  products are never negotiated: the bot says so first and suggests in-stock alternatives.
- **Direct answers (no model call):** availability and price of a named product, cheapest / most expensive, price-talk on a
  known product, greetings, thanks, yes/no to "connect me with the team". These are instant and exact.
- **Groq free tier limits (measured):** 8,000 tokens/min and **200,000 tokens/day per model** (a rolling refill of ~139
  tokens/min). A model-written reply costs about 2.5k tokens, so the free tier supports roughly 250 model replies per day
  across the three models. Direct answers and the FAQ cache do not use tokens. For real traffic add a payment method in
  Groq (Developer tier, about $0.0006 per reply for gpt-oss-120b); no code change is needed.
- **Checks without the model:** `node scripts/logic-check.mts` (from `web/`) tests product matching, price detection, memory
  and the direct answers. `scripts/eval-chat.mts` runs the question set against the real model (uses free-tier tokens).

### What the assistant can and cannot do (access model)
- **Can (read only):** public product list and knowledge base; the signed-in customer's OWN recent orders (fetched with the
  customer's own token, so database rules apply) to answer "where is my order".
- **Can propose:** an order (product, quantity, total). It appears as a "Confirm your order" card; the order is placed only
  when the customer presses Confirm, using their own signed-in session and the existing `place_order()` function (stock check,
  price snapshot, row level security). A chat message alone can never create an order.
- **Can request:** a call-back from the team (contact form, only after the customer says yes).
- **Cannot:** take payments, change prices or give discounts, cancel or edit orders, see other customers' data, use any
  admin function, or touch products and stock. The server never holds a service key.

### Support tickets (comments and updates)
- Run `supabase/migrations/20261011000000_ticket_comments.sql` once in the Supabase SQL editor.
- **Admin** (`/admin/support`): filter by Open / In progress / Resolved, change the status, post updates the customer can
  see, add internal notes only admins can see, read the chat that led to the ticket, and use **Email customer**.
  The first public reply moves an open ticket to In progress.
- **Customer** (`/tickets`, "Support" in the menu, with a New ticket button): sees their own tickets and the team's updates, and can reply. A reply on a
  resolved ticket reopens it. Visitors who were not signed in get no in-app view; admins email them instead.
- Comments can only be added through `add_ticket_comment()`, which checks who may write on which ticket.
- No automatic email notifications are sent yet (that needs an email service such as Resend).

## Checkout, GPay payment and shipping
Flow: **Buy** -> checkout (delivery address) -> order placed (stock reserved) -> pay with GPay / any UPI app -> customer enters the
UPI transaction ID (UTR) -> admin checks the bank and confirms -> admin ships (courier + tracking) -> delivered.
- **Setup:** run `supabase/migrations/20261012000000_checkout.sql` in the Supabase SQL editor (also run `seed_kb.sql` again for the
  updated chatbot knowledge). Then sign in as admin, open **Payment** in the menu and enter your UPI ID.
- **Currency:** Indian rupees (UPI works only in INR). The numbers in your product list are now shown as rupees.
- **Statuses:** awaiting_payment, payment_submitted, paid, shipped, delivered, cancelled. Status changes happen only through
  database functions (`place_order`, `submit_payment`, `cancel_my_order`, `admin_*`), each with its own permission check and a
  timeline entry the customer can see on My orders.
- **Admin alerts:** an "Orders" badge counts orders that need action (payment to verify, paid and ready to ship), and a pop-up
  appears live when an order is placed or a customer submits a payment. There are no email alerts yet (needs an email service).
- **Important:** a UPI transaction ID typed by a customer is not proof of payment. Always match it against your bank statement
  before pressing "Confirm payment received". For automatic verification use a payment gateway (Razorpay, Cashfree, PhonePe).
- The chat assistant can start an order but never places it: the customer finishes address and payment on the checkout page.

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
