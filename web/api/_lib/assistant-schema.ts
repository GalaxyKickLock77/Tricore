export const PAGE_PATHS = [
  '/shop',
  '/orders',
  '/tickets',
  '/admin/support',
  '/admin/orders',
  '/admin/products',
  '/admin/knowledge',
  '/admin/settings',
] as const

export type PagePath = (typeof PAGE_PATHS)[number]

export interface AssistantLink {
  path: PagePath | '/login'
  label: string
}

export const PAGE_LABELS: Record<PagePath, string> = {
  '/shop': 'Choose a product',
  '/orders': 'View my orders',
  '/tickets': 'Open support',
  '/admin/support': 'Open support tickets',
  '/admin/orders': 'Manage orders',
  '/admin/products': 'Manage products',
  '/admin/knowledge': 'Manage knowledge',
  '/admin/settings': 'Open settings',
}

export interface AssistantToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AssistantModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: AssistantToolCall[]
  tool_call_id?: string
}

/** Capabilities, not question keywords: the model decides when each tool is needed. */
export const ASSISTANT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_store',
      description: 'Search Tricore knowledge articles and the live product catalog. Use for any product, price, stock, recommendation, comparison, policy, or how-to question.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A focused search query, including relevant context from earlier chat turns.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_account',
      description:
        'Live counts, statuses, history and tracking for orders, support tickets and the catalogue, computed in the database for the person asking. Use it for ANY how-many, closed, open, pending, resolved, in-progress, shipped, delivered, cancelled, out-of-stock or recent question. For tickets, total is all tickets in scope; open, in_progress, resolved and pending are separate returned counts. "Available in the support section" means total unless a status is specified. Row level security gives a customer their own records and an admin the whole store; the payload states its scope and status vocabulary.',
      parameters: {
        type: 'object',
        properties: {
          resource: {
            type: 'string',
            enum: ['orders', 'tickets', 'catalog', 'all'],
            description: 'tickets for support questions, orders for purchases and delivery, catalog for stock levels, all for a general or store-wide overview.',
          },
        },
        required: ['resource'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_checkout',
      description: 'Validate a live product and prepare a checkout button. This does not place an order. Use after identifying the exact product with search_store.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'The exact product UUID returned by search_store, without the product: prefix.' },
          quantity: { type: 'integer', minimum: 1, maximum: 50 },
        },
        required: ['product_id', 'quantity'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_page',
      description: 'Add a safe in-app navigation button when it is the useful next step. For a checkout request without a chosen product, open /shop so the customer can choose one.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'string', enum: [...PAGE_PATHS, '/login'] },
          label: { type: 'string', description: 'Short button label, up to 40 characters.' },
        },
        required: ['page'],
        additionalProperties: false,
      },
    },
  },
] as const
