import type { InjectOptions } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMUNITY_JID, communityMetadata, fakeCommunityClient, SUBGROUP_JID } from '../helpers/community-client'
import { ADMIN_KEY, buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

describe('community routes', () => {
  let ctx: TestApp
  let apiKey: string
  const client = fakeCommunityClient()
  const { group } = client
  const base = '/v1/communities/120363000000000000'
  const inject = (method: InjectOptions['method'], url: string, payload?: InjectOptions['payload']) =>
    ctx.app.inject({ method, url, headers: { 'x-api-key': apiKey }, ...(payload === undefined ? {} : { payload }) })

  beforeAll(async () => {
    ctx = await buildTestApp()
    apiKey = (await createInstance(ctx.app, 'communities')).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue(client as never)
  })
  beforeEach(() => vi.clearAllMocks())
  afterAll(async () => {
    await ctx.app.close()
  })

  it('creates a community with all upstream options', async () => {
    const options = {
      description: 'Description',
      membershipApprovalMode: 'open',
      allowNonAdminSubGroupCreation: false,
      createGeneralChat: true,
    }
    const response = await inject('POST', '/v1/communities', { subject: 'Community', ...options })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ community: communityMetadata() })
    expect(group.createCommunity).toHaveBeenCalledWith('Community', options)
  })

  it.each(['120363000000000000', COMMUNITY_JID])('reads full community metadata for %s', async (id) => {
    const response = await inject('GET', `/v1/communities/${id}`)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ community: communityMetadata() })
    expect(group.queryGroupMetadata).toHaveBeenCalledWith(COMMUNITY_JID)
  })

  it('deactivates a community', async () => {
    const response = await inject('DELETE', base)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(group.deactivateCommunity).toHaveBeenCalledWith(COMMUNITY_JID)
  })

  it('returns sub-groups and the announcement group', async () => {
    const response = await inject('GET', `${base}/subgroups`)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual(await group.fetchSubGroups.mock.results[0]?.value)
    expect(group.fetchSubGroups).toHaveBeenCalledWith(COMMUNITY_JID)
  })

  it('returns merged participants with identity fields intact', async () => {
    const response = await inject('GET', `${base}/participants`)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ participants: communityMetadata().participants })
    expect(group.queryLinkedGroupsParticipants).toHaveBeenCalledWith(COMMUNITY_JID)
  })

  it('normalizes the hint and preserves nullable suggestion fields', async () => {
    const response = await inject('GET', `${base}/subgroups/suggestions?hint=120363000000000001`)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ suggestions: await group.fetchSubgroupSuggestions.mock.results[0]?.value })
    expect(group.fetchSubgroupSuggestions).toHaveBeenCalledWith(COMMUNITY_JID, SUBGROUP_JID)
  })

  it.each(['link', 'unlink'] as const)('returns partial %s failures without masking them', async (action) => {
    const response = await inject('POST', `${base}/subgroups/${action}`, {
      groups: ['120363000000000001', '888@g.us'],
      ...(action === 'unlink' ? { removeOrphanedMembers: true } : {}),
    })
    const method = action === 'link' ? group.linkSubGroups : group.unlinkSubGroups
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ result: await method.mock.results[0]?.value })
    if (action === 'link') expect(method).toHaveBeenCalledWith(COMMUNITY_JID, [SUBGROUP_JID, '888@g.us'])
    else expect(method).toHaveBeenCalledWith(COMMUNITY_JID, [SUBGROUP_JID, '888@g.us'], { removeOrphanedMembers: true })
  })

  it('joins a linked sub-group without inventing metadata', async () => {
    const response = await inject('POST', `${base}/subgroups/120363000000000001/join`)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(group.joinLinkedGroup).toHaveBeenCalledWith(COMMUNITY_JID, SUBGROUP_JID, undefined)
  })

  it('passes optional join type', async () => {
    const response = await inject('POST', `${base}/subgroups/${SUBGROUP_JID}/join`, { type: 'custom' })
    expect(response.statusCode, response.body).toBe(200)
    expect(group.joinLinkedGroup).toHaveBeenCalledWith(COMMUNITY_JID, SUBGROUP_JID, { type: 'custom' })
  })

  it('resolves the new owner phone to its WhatsApp JID', async () => {
    const response = await inject('POST', `${base}/owner`, { user: '5511999999999' })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(client.profile.getLidsByPhoneNumbers).toHaveBeenCalled()
    expect(group.transferCommunityOwnership).toHaveBeenCalledWith(COMMUNITY_JID, '5511999999999@s.whatsapp.net')
  })

  const existingRoutes: [InjectOptions['method'], string, InjectOptions['payload']?][] = [
    ['GET', ''],
    ['DELETE', ''],
    ['GET', '/subgroups'],
    ['GET', '/participants'],
    ['GET', '/subgroups/suggestions?hint=123'],
    ['POST', '/subgroups/link', { groups: ['123'] }],
    ['POST', '/subgroups/unlink', { groups: ['123'] }],
    ['POST', '/subgroups/123/join'],
    ['POST', '/owner', { user: '222@lid' }],
  ]
  it.each(existingRoutes)('returns 404 for an unknown community: %s %s', async (method, path, payload) => {
    const response = await inject(method, `/v1/communities/999${path}`, payload)
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('WA_NOT_FOUND')
  })

  it('returns 404 for a group that is not a community', async () => {
    expect((await inject('DELETE', `/v1/communities/${SUBGROUP_JID}`)).statusCode).toBe(404)
    expect(group.deactivateCommunity).not.toHaveBeenCalled()
  })

  it.each(['link', 'unlink'])('rejects an empty %s list before calling upstream', async (action) => {
    const response = await inject('POST', `${base}/subgroups/${action}`, { groups: [] })
    expect(response.statusCode).toBe(400)
    expect(group.queryGroupMetadata).not.toHaveBeenCalled()
    expect(group.linkSubGroups).not.toHaveBeenCalled()
    expect(group.unlinkSubGroups).not.toHaveBeenCalled()
  })

  it.each(['bad', '123@lid'])('rejects invalid community id %s', async (id) => {
    expect((await inject('GET', `/v1/communities/${id}`)).statusCode).toBe(400)
  })

  it('requires a hint for suggestions', async () => {
    expect((await inject('GET', `${base}/subgroups/suggestions`)).statusCode).toBe(400)
  })

  it('preserves community metadata in both group read routes', async () => {
    const single = await inject('GET', `/v1/groups/${SUBGROUP_JID}`)
    const list = await inject('GET', '/v1/groups')
    expect(single.statusCode).toBe(200)
    expect(list.statusCode).toBe(200)
    expect(single.json().group).toEqual(list.json().groups[1])
    expect(single.json().group).toMatchObject({ isParentGroup: false, linkedParentJid: COMMUNITY_JID })
    expect(list.json().groups[0]).toEqual(communityMetadata())
  })

  it('rejects missing auth and admin keys on the instance surface', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: base })).statusCode).toBe(401)
    expect((await ctx.app.inject({ method: 'GET', url: base, headers: { 'x-api-key': ADMIN_KEY } })).statusCode).toBe(
      403,
    )
  })
})
