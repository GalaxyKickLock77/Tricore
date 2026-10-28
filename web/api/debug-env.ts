export async function GET(): Promise<Response> {
  const present = (v: string | undefined) => Boolean(v && v.trim())
  return new Response(
    JSON.stringify({
      SMTP_HOST: present(process.env.SMTP_HOST),
      SMTP_PORT: present(process.env.SMTP_PORT),
      SMTP_USER: present(process.env.SMTP_USER),
      SMTP_PASS: present(process.env.SMTP_PASS),
      MAIL_FROM: present(process.env.MAIL_FROM),
      NOTIFY_SECRET: present(process.env.NOTIFY_SECRET),
      APP_URL: present(process.env.APP_URL),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}
