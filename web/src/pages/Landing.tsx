import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { useTheme } from 'next-themes'
import {
  ArrowRight, BadgeCheck, CreditCard, Cpu, Headset, KeyRound, Laptop, Mail, MessageSquare,
  Moon, Network, PackageCheck, Phone, Printer, Search, Server, ShieldCheck, Store, Sun, Truck,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { brand, contact } from '@/config'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const categories = [
  { icon: Laptop, name: 'Laptops & Desktops', text: 'Business and home computers, ready to work.' },
  { icon: Network, name: 'Networking', text: 'Routers, switches and Wi-Fi for stable connectivity.' },
  { icon: Server, name: 'Servers & Storage', text: 'Reliable hardware to run and protect your data.' },
  { icon: ShieldCheck, name: 'Security & CCTV', text: 'Cameras, firewalls and access control.' },
  { icon: Printer, name: 'Peripherals', text: 'Printers, monitors, keyboards and accessories.' },
  { icon: KeyRound, name: 'Software & Licenses', text: 'Genuine licenses for the tools your team uses.' },
]

const steps = [
  { icon: Search, title: 'Browse & choose', text: 'Sign in with Google and pick the products you need.' },
  { icon: MessageSquare, title: 'Place your order', text: 'Send your order and our team contacts you to confirm details.' },
  { icon: CreditCard, title: 'Pay securely', text: 'Complete payment with our team. We start only after it is received.' },
  { icon: PackageCheck, title: 'We ship & you track', text: 'Your order is shipped to you and its status is updated in your account.' },
]

const reasons = [
  { icon: BadgeCheck, title: 'Genuine products', text: 'Quality IT hardware and software from trusted sources.' },
  { icon: Headset, title: 'Real people to talk to', text: 'Talk to our team about your needs before you buy.' },
  { icon: Truck, title: 'Shipped to your door', text: 'Orders are dispatched after payment, with status updates.' },
  { icon: ShieldCheck, title: 'Safe account', text: 'Google sign-in means no extra passwords to remember.' },
]

const fade = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.45, ease: 'easeOut' as const },
}

export default function Landing() {
  const { session } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const cta = session ? { to: '/shop', label: 'Open shop' } : { to: '/signup', label: 'Get started' }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Cpu className="size-4" />
            </span>
            {brand.name}
          </Link>
          <nav className="ml-6 hidden items-center gap-6 text-sm text-muted-foreground md:flex" aria-label="Sections">
            <a href="#categories" className="hover:text-foreground">Products</a>
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#why" className="hover:text-foreground">Why us</a>
            <a href="#contact" className="hover:text-foreground">Contact</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Toggle theme"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
              <Sun className="size-4 dark:hidden" />
              <Moon className="hidden size-4 dark:block" />
            </Button>
            {!session && <Button asChild variant="ghost" className="hidden sm:inline-flex"><Link to="/login">Sign in</Link></Button>}
            <Button asChild size="lg"><Link to={cta.to}>{cta.label}</Link></Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-32 -top-32 size-[28rem] rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 top-20 size-[24rem] rounded-full bg-sky-500/15 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:py-24 lg:grid-cols-2">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
              <BadgeCheck className="size-3.5 text-primary" /> Your trusted IT products partner
            </span>
            <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Everything your business needs in <span className="text-primary">IT</span>, delivered to you.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              Choose from laptops, networking, servers, security and more. Talk to our team, pay, and we ship it to your door,
              with every step tracked in your account.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-11 px-5 text-base">
                <Link to={cta.to}>{cta.label} <ArrowRight className="size-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 px-5 text-base">
                <a href="#how">See how it works</a>
              </Button>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {['Genuine products', 'Pay after you confirm with us', 'Order tracking'].map((t) => (
                <li key={t} className="flex items-center gap-1.5"><BadgeCheck className="size-4 text-primary" />{t}</li>
              ))}
            </ul>
          </motion.div>

          {/* Visual */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="relative mx-auto w-full max-w-md"
            aria-hidden="true"
          >
            <div className="rounded-3xl border bg-gradient-to-br from-primary/10 via-background to-sky-500/10 p-6 shadow-xl">
              <div className="grid grid-cols-2 gap-4">
                {[Laptop, Server, Network, ShieldCheck].map((Icon, i) => (
                  <motion.div
                    key={i}
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 4, repeat: Infinity, delay: i * 0.4, ease: 'easeInOut' }}
                    className="grid aspect-square place-items-center rounded-2xl border bg-card shadow-sm"
                  >
                    <Icon className="size-12 text-primary" strokeWidth={1.5} />
                  </motion.div>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between rounded-xl border bg-card p-3">
                <div className="flex items-center gap-2 text-sm font-medium"><Truck className="size-4 text-primary" /> Order shipped</div>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">Tracked</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Categories */}
      <section id="categories" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <motion.div {...fade} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Shop by category</h2>
          <p className="mt-2 text-muted-foreground">Whatever you are building or fixing, we can get it for you.</p>
        </motion.div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map(({ icon: Icon, name, text }, i) => (
            <motion.div key={name} {...fade} transition={{ ...fade.transition, delay: i * 0.05 }} whileHover={{ y: -4 }}>
              <Card className="h-full transition-shadow hover:shadow-lg">
                <CardContent className="space-y-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
                  <h3 className="font-semibold">{name}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 bg-muted/40 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <motion.div {...fade} className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
            <p className="mt-2 text-muted-foreground">Simple, personal and safe. From first click to delivery.</p>
          </motion.div>
          <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(({ icon: Icon, title, text }, i) => (
              <motion.li key={title} {...fade} transition={{ ...fade.transition, delay: i * 0.08 }} className="relative rounded-2xl border bg-card p-5">
                <span className="absolute -top-3 left-5 grid size-7 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
                <Icon className="mt-2 size-7 text-primary" />
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </motion.li>
            ))}
          </ol>
        </div>
      </section>

      {/* Why us */}
      <section id="why" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <motion.div {...fade} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Why customers choose {brand.short}</h2>
        </motion.div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {reasons.map(({ icon: Icon, title, text }, i) => (
            <motion.div key={title} {...fade} transition={{ ...fade.transition, delay: i * 0.06 }} className="flex gap-4 rounded-2xl border bg-card p-5">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
              <div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA + contact */}
      <section id="contact" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-16">
        <motion.div {...fade} className="relative overflow-hidden rounded-3xl bg-primary p-8 text-primary-foreground md:p-12">
          <div className="absolute -right-16 -top-16 size-64 rounded-full bg-white/10" />
          <div className="relative max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">Ready to get your IT products?</h2>
            <p className="mt-2 text-primary-foreground/80">
              Sign in, choose what you need, and our team will take it from there.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" variant="secondary" className="h-11 px-5 text-base">
                <Link to={cta.to}>{cta.label} <ArrowRight className="size-4" /></Link>
              </Button>
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-2 text-sm underline-offset-4 hover:underline">
                  <Mail className="size-4" /> {contact.email}
                </a>
              )}
              {contact.phone && (
                <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-2 text-sm underline-offset-4 hover:underline">
                  <Phone className="size-4" /> {contact.phone}
                </a>
              )}
            </div>
            {(contact.email || contact.phone) && <p className="mt-3 text-sm text-primary-foreground/70">{contact.hours}</p>}
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><Store className="size-4" /> © {new Date().getFullYear()} {brand.name}</span>
          <span className="flex gap-4">
            <a href="#categories" className="hover:text-foreground">Products</a>
            <a href="#how" className="hover:text-foreground">How it works</a>
            <Link to="/login" className="hover:text-foreground">Sign in</Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
