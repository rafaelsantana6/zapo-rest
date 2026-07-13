import type { Locale } from '../i18n/types'

export type NavItem = {
  id: string
  title: string
  href: string
  /** Match path prefix for active state */
  match?: string
  /** Leave the SPA (Scalar, raw OpenAPI JSON) */
  external?: boolean
}

export type NavGroup = {
  title: string
  items: NavItem[]
}

type NavCopy = {
  intro: string
  guide: string
  httpRef: string
  tools: string
  items: Record<string, string>
}

const NAV_COPY: Record<Locale, NavCopy> = {
  'pt-BR': {
    intro: 'Introdução',
    guide: 'Guia',
    httpRef: 'Referência HTTP',
    tools: 'Ferramentas',
    items: {
      intro: 'O que é zapo-rest',
      why: 'Vantagens de design',
      quickstart: 'Quickstart',
      architecture: 'Arquitetura',
      concepts: 'Conceitos & entidades',
      auth: 'Autenticação',
      instances: 'Instâncias & pairing',
      messages: 'Mensagens',
      media: 'Mídia & storage',
      chats: 'Chats & histórico',
      contacts: 'Contatos & JID/LID',
      presence: 'Presence & typing',
      webhooks: 'Webhooks',
      realtime: 'SSE /events',
      voip: 'VoIP & softphone',
      groups: 'Grupos',
      errors: 'Erros & códigos',
      'api-index': 'Todos os endpoints',
      swagger: 'Scalar API Reference',
      'openapi-json': 'OpenAPI JSON',
      faq: 'FAQ',
    },
  },
  en: {
    intro: 'Introduction',
    guide: 'Guide',
    httpRef: 'HTTP reference',
    tools: 'Tools',
    items: {
      intro: 'What is zapo-rest',
      why: 'Design advantages',
      quickstart: 'Quickstart',
      architecture: 'Architecture',
      concepts: 'Concepts & entities',
      auth: 'Authentication',
      instances: 'Instances & pairing',
      messages: 'Messages',
      media: 'Media & storage',
      chats: 'Chats & history',
      contacts: 'Contacts & JID/LID',
      presence: 'Presence & typing',
      webhooks: 'Webhooks',
      realtime: 'SSE /events',
      voip: 'VoIP & softphone',
      groups: 'Groups',
      errors: 'Errors & codes',
      'api-index': 'All endpoints',
      swagger: 'Scalar API Reference',
      'openapi-json': 'OpenAPI JSON',
      faq: 'FAQ',
    },
  },
  es: {
    intro: 'Introducción',
    guide: 'Guía',
    httpRef: 'Referencia HTTP',
    tools: 'Herramientas',
    items: {
      intro: 'Qué es zapo-rest',
      why: 'Ventajas de diseño',
      quickstart: 'Quickstart',
      architecture: 'Arquitectura',
      concepts: 'Conceptos y entidades',
      auth: 'Autenticación',
      instances: 'Instancias y pairing',
      messages: 'Mensajes',
      media: 'Media y storage',
      chats: 'Chats e historial',
      contacts: 'Contactos y JID/LID',
      presence: 'Presence y typing',
      webhooks: 'Webhooks',
      realtime: 'SSE /events',
      voip: 'VoIP y softphone',
      groups: 'Grupos',
      errors: 'Errores y códigos',
      'api-index': 'Todos los endpoints',
      swagger: 'Scalar API Reference',
      'openapi-json': 'OpenAPI JSON',
      faq: 'FAQ',
    },
  },
}

/** API tag nav labels stay English (match OpenAPI tags). */
const API_TAGS = [
  'Health',
  'Auth',
  'Instances',
  'Messages',
  'Chats',
  'Contacts',
  'Media',
  'Presence',
  'Calls',
  'Webhooks',
  'Groups',
  'Labels',
  'Lids',
  'Profile',
  'Privacy',
  'Status',
  'Business',
  'Realtime',
] as const

function tItem(copy: NavCopy, id: string, fallback: string): string {
  return copy.items[id] ?? fallback
}

export function getNav(locale: Locale): NavGroup[] {
  const c = NAV_COPY[locale]
  return [
    {
      title: c.intro,
      items: [
        { id: 'intro', title: tItem(c, 'intro', 'Intro'), href: '/guide/' },
        { id: 'why', title: tItem(c, 'why', 'Design advantages'), href: '/guide/why' },
        { id: 'quickstart', title: tItem(c, 'quickstart', 'Quickstart'), href: '/guide/quickstart' },
        { id: 'architecture', title: tItem(c, 'architecture', 'Architecture'), href: '/guide/architecture' },
        { id: 'concepts', title: tItem(c, 'concepts', 'Concepts'), href: '/guide/concepts' },
      ],
    },
    {
      title: c.guide,
      items: [
        { id: 'auth', title: tItem(c, 'auth', 'Auth'), href: '/guide/auth' },
        { id: 'instances', title: tItem(c, 'instances', 'Instances'), href: '/guide/instances' },
        { id: 'messages', title: tItem(c, 'messages', 'Messages'), href: '/guide/messages' },
        { id: 'media', title: tItem(c, 'media', 'Media'), href: '/guide/media' },
        { id: 'chats', title: tItem(c, 'chats', 'Chats'), href: '/guide/chats' },
        { id: 'contacts', title: tItem(c, 'contacts', 'Contacts'), href: '/guide/contacts' },
        { id: 'presence', title: tItem(c, 'presence', 'Presence'), href: '/guide/presence' },
        { id: 'webhooks', title: tItem(c, 'webhooks', 'Webhooks'), href: '/guide/webhooks' },
        { id: 'realtime', title: tItem(c, 'realtime', 'SSE'), href: '/guide/realtime' },
        { id: 'voip', title: tItem(c, 'voip', 'VoIP'), href: '/guide/voip' },
        { id: 'groups', title: tItem(c, 'groups', 'Groups'), href: '/guide/groups' },
        { id: 'errors', title: tItem(c, 'errors', 'Errors'), href: '/guide/errors' },
      ],
    },
    {
      title: c.httpRef,
      items: [
        { id: 'api-index', title: tItem(c, 'api-index', 'All endpoints'), href: '/guide/api' },
        ...API_TAGS.map((tag) => ({
          id: `api-${tag.toLowerCase()}`,
          title: tag === 'Calls' ? 'Calls / VoIP' : tag,
          href: `/guide/api/${tag}`,
        })),
      ],
    },
    {
      title: c.tools,
      items: [
        {
          id: 'swagger',
          title: tItem(c, 'swagger', 'Scalar'),
          href: '/docs',
          match: '/docs',
          external: true,
        },
        {
          id: 'openapi-json',
          title: tItem(c, 'openapi-json', 'OpenAPI JSON'),
          href: '/docs/json',
          match: '/docs/json',
          external: true,
        },
        { id: 'faq', title: tItem(c, 'faq', 'FAQ'), href: '/guide/faq' },
      ],
    },
  ]
}

/** @deprecated use getNav(locale) */
export const NAV = getNav('pt-BR')
