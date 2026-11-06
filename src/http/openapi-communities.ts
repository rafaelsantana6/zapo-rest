/** Swagger marks every schema.body required; joining a linked group accepts no body. */
export function documentOptionalCommunityJoinBody(document: Record<string, unknown>): void {
  const paths = document.paths as Record<string, { post?: { requestBody?: { required?: boolean } } }> | undefined
  const body = paths?.['/v1/communities/{communityId}/subgroups/{groupId}/join']?.post?.requestBody
  if (body) body.required = false
}
