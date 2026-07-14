import { describe, expect, it } from 'vitest'
import { injectMultipartMediaBodies } from '~/http/openapi-multipart'

type ContentMap = Record<
  string,
  {
    schema?: { properties?: Record<string, { format?: string; contentMediaType?: string }> }
    encoding?: Record<string, { contentType?: string }>
  }
>

function opContent(doc: Record<string, unknown>, path: string, method: string): ContentMap {
  const paths = doc.paths as Record<string, Record<string, { requestBody?: { content?: ContentMap } }>>
  const content = paths[path]?.[method]?.requestBody?.content
  if (!content) throw new Error(`missing content for ${method.toUpperCase()} ${path}`)
  return content
}

function contentTypeOrder(content: ContentMap): string[] {
  return Object.keys(content)
}

describe('injectMultipartMediaBodies', () => {
  it('puts multipart first with binary file + encoding for profile image', () => {
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
    expect(contentTypeOrder(content)[0]).toBe('multipart/form-data')
    expect(contentTypeOrder(content)).toContain('application/json')
    expect(content['multipart/form-data']?.schema?.properties?.file?.format).toBe('binary')
    expect(content['multipart/form-data']?.encoding?.file?.contentType).toMatch(/image/)
    // file listed first among properties
    expect(Object.keys(content['multipart/form-data']?.schema?.properties ?? {})[0]).toBe('file')
  })

  it('covers all media routes and leaves text-only alone', () => {
    const paths: Record<string, unknown> = {
      '/v1/messages/image': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['to'],
                  properties: { to: { type: 'string' }, mediaUrl: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      '/v1/messages/video': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', required: ['to'], properties: { to: { type: 'string' } } },
              },
            },
          },
        },
      },
      '/v1/messages/audio': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', required: ['to'], properties: { to: { type: 'string' } } },
              },
            },
          },
        },
      },
      '/v1/messages/document': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', required: ['to'], properties: { to: { type: 'string' } } },
              },
            },
          },
        },
      },
      '/v1/messages/sticker': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', required: ['to'], properties: { to: { type: 'string' } } },
              },
            },
          },
        },
      },
      '/v1/status/send': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['recipients'],
                  properties: { recipients: { type: 'array', items: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      '/v1/calls/blast': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', required: ['to'], properties: { to: { type: 'string' } } },
              },
            },
          },
        },
      },
      '/v1/groups/{groupId}/picture': {
        put: {
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { mediaUrl: { type: 'string' } } },
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
    }

    const doc = injectMultipartMediaBodies({ paths })
    for (const p of [
      '/v1/messages/image',
      '/v1/messages/video',
      '/v1/messages/audio',
      '/v1/messages/document',
      '/v1/messages/sticker',
      '/v1/status/send',
      '/v1/calls/blast',
    ]) {
      const content = opContent(doc, p, 'post')
      expect(contentTypeOrder(content)[0], p).toBe('multipart/form-data')
      expect(content['multipart/form-data']?.schema?.properties?.file?.format, p).toBe('binary')
    }
    expect(opContent(doc, '/v1/groups/{groupId}/picture', 'put')['multipart/form-data']).toBeTruthy()
    expect(opContent(doc, '/v1/messages/text', 'post')['multipart/form-data']).toBeUndefined()
  })
})
