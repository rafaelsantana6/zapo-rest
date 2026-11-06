import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

/**
 * Minimal browser security headers (no extra dependency).
 * CSP is intentionally loose enough for Scalar `/docs` + Vite dashboard/guide SPAs.
 */
const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'SAMEORIGIN')
    reply.header('Referrer-Policy', 'no-referrer')
    // Same-origin only: the softphone needs the mic, the camera and screen capture for video calls
    reply.header('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()')
    // Allow self + inline for Scalar/docs SPA; tighten at the reverse proxy if needed.
    if (!reply.getHeader('Content-Security-Policy')) {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; base-uri 'self'; frame-ancestors 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss: https: http:; font-src 'self' data:",
      )
    }
    return payload
  })
}

export const securityHeadersPlugin = fp(plugin, { name: 'security-headers' })
