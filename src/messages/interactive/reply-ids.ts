type ReplyId = { id?: string }
export type ReplyIdAllocator = (preferredId: string) => string

export function hasUniqueReplyIds(items: readonly ReplyId[]): boolean {
  const ids = items.flatMap((item) => (item.id === undefined ? [] : [item.id]))
  return new Set(ids).size === ids.length
}

/** Reserve caller IDs first so generated IDs cannot shadow an action supplied later. */
export function reserveReplyIds(items: readonly ReplyId[]): ReplyIdAllocator {
  if (!hasUniqueReplyIds(items)) throw new Error('Reply IDs must be unique within a message')
  const reserved = new Set(items.flatMap((item) => (item.id === undefined ? [] : [item.id])))
  return (preferredId) => {
    let id = preferredId
    for (let suffix = 2; reserved.has(id); suffix++) id = `${preferredId}_${suffix}`
    reserved.add(id)
    return id
  }
}
