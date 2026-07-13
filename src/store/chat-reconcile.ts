import type pg from 'pg'
import { bareUserJid, isLidJid, isPnJid, toPnJid } from '~/lib/jid-canon'
import { getLogger } from '~/lib/logger'
import type { ChatStore } from './chats'
import type { LidMapStore } from './lid-map'
import type { MessageStore } from './messages'

export type ReconcileResult = {
  mappingsFromContacts: number
  chatsMerged: number
  emptyLidChatsDeleted: number
  messagesRekeyed: number
}

/**
 * Bootstrap LID→PN map from zapo mailbox_contacts + app_contacts, re-key chats/messages,
 * and prune empty LID ghost threads ( only surface real conversations).
 */
export async function reconcileLidChats(
  pool: pg.Pool,
  instanceName: string,
  deps: { lidMap: LidMapStore; chats: ChatStore; messages: MessageStore },
): Promise<ReconcileResult> {
  const log = getLogger({ component: 'chat-reconcile', instance: instanceName })
  let mappingsFromContacts = 0
  let chatsMerged = 0
  let emptyLidChatsDeleted = 0
  let messagesRekeyed = 0

  // 1) Load pairs from mailbox_contacts (zapo) and app_contacts
  const pairs = new Map<string, string>() // lid → pn

  try {
    const { rows } = await pool.query<{ jid: string; lid: string | null; phone_number: string | null }>(
      `SELECT jid, lid, phone_number FROM mailbox_contacts WHERE session_id = $1`,
      [instanceName],
    )
    for (const r of rows) {
      addPair(pairs, r.jid, r.lid, r.phone_number)
    }
  } catch (err) {
    log.debug({ err }, 'mailbox_contacts not readable yet')
  }

  try {
    const { rows } = await pool.query<{ jid: string; lid: string | null; phone_number: string | null }>(
      `SELECT jid, lid, phone_number FROM app_contacts WHERE instance_name = $1`,
      [instanceName],
    )
    for (const r of rows) {
      addPair(pairs, r.jid, r.lid, r.phone_number)
    }
  } catch {
    // ignore
  }

  // Batch upsert — sequential save() over 10k+ pairs blocked HTTP listen past healthcheck.
  mappingsFromContacts = await deps.lidMap.saveMany(
    instanceName,
    [...pairs.entries()].map(([lid, pn]) => ({ lid, pn })),
  )

  // 2) Re-key every LID chat that has a PN mapping
  const { rows: lidChats } = await pool.query<{ chat_jid: string }>(
    `SELECT chat_jid FROM app_chats
 WHERE instance_name = $1 AND chat_jid LIKE '%@lid'`,
    [instanceName],
  )

  // One batch lookup instead of a findPnByLid per LID chat (was N+1).
  const pnByLid = await deps.lidMap.findPnsByLids(
    instanceName,
    lidChats.map((c) => c.chat_jid),
  )
  for (const { chat_jid } of lidChats) {
    const pn = pnByLid.get(bareUserJid(chat_jid))
    if (!pn) continue
    const n = await deps.messages.rekeyChat(instanceName, chat_jid, pn)
    messagesRekeyed += n
    await deps.chats.mergeLidIntoPn(instanceName, chat_jid, pn)
    chatsMerged++
  }

  // 3) Delete ghost chats with zero messages and no activity (contact-list residue)
  const del = await pool.query(
    `DELETE FROM app_chats c
 WHERE c.instance_name = $1
 AND c.is_group = false
 AND (c.last_message_ts IS NULL)
 AND (c.unread_count IS NULL OR c.unread_count = 0)
 AND NOT EXISTS (
 SELECT 1 FROM app_messages m
 WHERE m.instance_name = c.instance_name AND m.chat_jid = c.chat_jid
 )`,
    [instanceName],
  )
  emptyLidChatsDeleted = del.rowCount ?? 0

  // 4) Drop chats that only have empty unknown history stubs (no body/media/live)
  const delStubs = await pool.query(
    `DELETE FROM app_chats c
 WHERE c.instance_name = $1
 AND c.is_group = false
 AND (c.last_message_ts IS NULL OR c.last_message_preview IS NULL OR c.last_message_preview IN ('', '[histórico]', '[protocol]', '[unknown]'))
 AND NOT EXISTS (
 SELECT 1 FROM app_messages m
 WHERE m.instance_name = c.instance_name
 AND m.chat_jid = c.chat_jid
 AND (
 m.source = 'live'
 OR m.type NOT IN ('unknown', 'protocol')
 OR m.body IS NOT NULL
 OR m.caption IS NOT NULL
 OR m.has_media = true
 )
 )`,
    [instanceName],
  )
  emptyLidChatsDeleted += delStubs.rowCount ?? 0

  // 5) Fill missing names from app_contacts / mailbox_contacts
  await pool.query(
    `UPDATE app_chats c SET
 name = COALESCE(c.name, ac.display_name, ac.push_name),
 updated_at = now()
 FROM app_contacts ac
 WHERE c.instance_name = $1
 AND ac.instance_name = c.instance_name
 AND (ac.jid = c.chat_jid OR ac.phone_number = split_part(c.chat_jid, '@', 1)
 OR ac.phone_number = c.chat_jid)
 AND (c.name IS NULL OR c.name = '')`,
    [instanceName],
  )

  // 6) Remove system jid
  await pool.query(
    `DELETE FROM app_chats WHERE instance_name = $1 AND (chat_jid = '0@s.whatsapp.net' OR chat_jid LIKE '0@%')`,
    [instanceName],
  )

  log.info({ mappingsFromContacts, chatsMerged, emptyLidChatsDeleted, messagesRekeyed }, 'lid chat reconcile done')

  return { mappingsFromContacts, chatsMerged, emptyLidChatsDeleted, messagesRekeyed }
}

function addPair(pairs: Map<string, string>, jid: string, lid: string | null, phoneNumber: string | null): void {
  let lidJid: string | null = null
  let pnJid: string | null = null

  if (isLidJid(jid)) lidJid = bareUserJid(jid)
  if (lid && isLidJid(lid)) lidJid = bareUserJid(lid)

  if (phoneNumber) {
    const raw = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`
    if (isPnJid(raw) || raw.includes('@s.whatsapp.net')) {
      pnJid = toPnJid(raw.includes('@') ? raw : `${raw}@s.whatsapp.net`)
    }
  }
  if (isPnJid(jid)) pnJid = toPnJid(jid)

  if (lidJid && pnJid) pairs.set(lidJid, pnJid)
}
