import type { Locale } from './types'

export type UiStrings = {
  brandDocs: string
  topbarSubtitle: string
  openMenu: string
  closeMenu: string
  searchNav: string
  openScalar: string
  openGitHub: string
  footerDocs: string
  footerOpenApi: string
  footerJson: string
  footerRepo: string
  language: string
  pageNotFound: string
  /** Full sentence with {link} placeholder around intro label */
  backToIntroBefore: string
  backToIntro: string
  backToIntroAfter: string
  apiIndexTitle: string
  apiIndexLead: (count: number) => string
  apiFilterPlaceholder: string
  apiNoMatch: string
  apiUnknownTag: string
  apiBackIndex: string
  apiHttpRef: string
  apiEndpointCount: (count: number) => string
  apiOpenScalar: string
  requestBody: string
  responseExample: string
  example: string
  themeToggle: string
}

const pt: UiStrings = {
  brandDocs: 'Documentação',
  topbarSubtitle: 'Guia de integração · API WhatsApp multi-session',
  openMenu: 'Abrir menu',
  closeMenu: 'Fechar menu',
  searchNav: 'Buscar na navegação…',
  openScalar: 'Abrir Scalar',
  openGitHub: 'GitHub',
  footerDocs: 'zapo-rest docs',
  footerOpenApi: 'OpenAPI / Scalar',
  footerJson: 'JSON',
  footerRepo: 'Repositório',
  language: 'Idioma',
  pageNotFound: 'Página não encontrada',
  backToIntroBefore: 'Volte para a ',
  backToIntro: 'introdução',
  backToIntroAfter: '.',
  apiIndexTitle: 'Referência de endpoints',
  apiIndexLead: (count) => `${count} operações documentadas. Para Try it out interativo, use o `,
  apiFilterPlaceholder: 'Filtrar por path, método, tag ou texto…',
  apiNoMatch: 'Nenhum endpoint corresponde ao filtro.',
  apiUnknownTag: 'Tag desconhecida',
  apiBackIndex: 'Voltar ao índice',
  apiHttpRef: 'Referência HTTP',
  apiEndpointCount: (count) => `${count} endpoint${count === 1 ? '' : 's'}`,
  apiOpenScalar: 'Abrir no Scalar',
  requestBody: 'Request body',
  responseExample: 'Response example',
  example: 'Exemplo',
  themeToggle: 'Alternar tema',
}

const en: UiStrings = {
  brandDocs: 'Documentation',
  topbarSubtitle: 'Integration guide · multi-session WhatsApp API',
  openMenu: 'Open menu',
  closeMenu: 'Close menu',
  searchNav: 'Search navigation…',
  openScalar: 'Open Scalar',
  openGitHub: 'GitHub',
  footerDocs: 'zapo-rest docs',
  footerOpenApi: 'OpenAPI / Scalar',
  footerJson: 'JSON',
  footerRepo: 'Repository',
  language: 'Language',
  pageNotFound: 'Page not found',
  backToIntroBefore: 'Back to the ',
  backToIntro: 'introduction',
  backToIntroAfter: '.',
  apiIndexTitle: 'Endpoint reference',
  apiIndexLead: (count) => `${count} documented operations. For interactive Try it out, use `,
  apiFilterPlaceholder: 'Filter by path, method, tag or text…',
  apiNoMatch: 'No endpoints match this filter.',
  apiUnknownTag: 'Unknown tag',
  apiBackIndex: 'Back to index',
  apiHttpRef: 'HTTP reference',
  apiEndpointCount: (count) => `${count} endpoint${count === 1 ? '' : 's'}`,
  apiOpenScalar: 'Open in Scalar',
  requestBody: 'Request body',
  responseExample: 'Response example',
  example: 'Example',
  themeToggle: 'Toggle theme',
}

const es: UiStrings = {
  brandDocs: 'Documentación',
  topbarSubtitle: 'Guía de integración · API WhatsApp multi-sesión',
  openMenu: 'Abrir menú',
  closeMenu: 'Cerrar menú',
  searchNav: 'Buscar en la navegación…',
  openScalar: 'Abrir Scalar',
  openGitHub: 'GitHub',
  footerDocs: 'zapo-rest docs',
  footerOpenApi: 'OpenAPI / Scalar',
  footerJson: 'JSON',
  footerRepo: 'Repositorio',
  language: 'Idioma',
  pageNotFound: 'Página no encontrada',
  backToIntroBefore: 'Vuelve a la ',
  backToIntro: 'introducción',
  backToIntroAfter: '.',
  apiIndexTitle: 'Referencia de endpoints',
  apiIndexLead: (count) => `${count} operaciones documentadas. Para Try it out interactivo, usa `,
  apiFilterPlaceholder: 'Filtrar por path, método, tag o texto…',
  apiNoMatch: 'Ningún endpoint coincide con el filtro.',
  apiUnknownTag: 'Tag desconocida',
  apiBackIndex: 'Volver al índice',
  apiHttpRef: 'Referencia HTTP',
  apiEndpointCount: (count) => `${count} endpoint${count === 1 ? '' : 's'}`,
  apiOpenScalar: 'Abrir en Scalar',
  requestBody: 'Request body',
  responseExample: 'Response example',
  example: 'Ejemplo',
  themeToggle: 'Cambiar tema',
}

export const UI: Record<Locale, UiStrings> = {
  'pt-BR': pt,
  en,
  es,
}
