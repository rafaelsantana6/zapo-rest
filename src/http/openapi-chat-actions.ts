/** Swagger treats every declared body as required; these two Zod bodies also accept omission. */
export function optionalChatActionBodies(document: Record<string, unknown>): Record<string, unknown> {
  const paths = document.paths as Record<string, { post?: { requestBody?: { required?: boolean } } }> | undefined
  for (const [path, operations] of Object.entries(paths ?? {})) {
    if (!/\/chats\/\{chatId\}\/(clear|delete)$/.test(path)) continue
    const body = operations.post?.requestBody
    if (body) body.required = false
  }
  return document
}
