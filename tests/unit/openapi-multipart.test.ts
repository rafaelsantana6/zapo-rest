import { describe, expect, it } from 'vitest'
import { injectMultipartMediaBodies } from '~/http/openapi-multipart'

type ContentMap = Record<string, { schema?: { properties?: Record<string, { format?: string }> } }>

function opContent(doc: Record<string, unknown>, path: string, method: string): ContentMap {
  const paths = doc.paths as Record<string, Record<string, { requestBody?: { content?: ContentMap } }>>
  const content = paths[path]?.[method]?.requestBody?.content
  if (!content) throw new Error(`missing content for ${method.toUpperCase()} ${path}`)
  return content
}

describe('injectMultipartMediaBodies', () => {
  it('adds multipart/form-data with binary file on profile image PUT', () => {
    const doc = injectMultipartMediaBodies({
      paths: {
        '/v1/profile/image': {
          put: {
            summary: 'Set profile picture (avatar)',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      mediaUrl: { type: 'string' },
                      mediaBase64: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    const content = opContent(doc, '/v1/profile/image', 'put')
    expect(Object.keys(content).sort()).toEqual(['application/json', 'multipart/form-data'])
    expect(content['multipart/form-data']?.schema?.properties?.file?.format).toBe('binary')
  })

  it('adds multipart on messages/image and leaves text-only routes alone', () => {
    const doc = injectMultipartMediaBodies({
      paths: {
        '/v1/messages/image': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['to'],
                    properties: {
                      to: { type: 'string' },
                      mediaUrl: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        '/v1/messages/text': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { to: { type: 'string' }, text: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
    })
    expect(opContent(doc, '/v1/messages/image', 'post')['multipart/form-data']).toBeTruthy()
    expect(opContent(doc, '/v1/messages/text', 'post')['multipart/form-data']).toBeUndefined()
  })
})
