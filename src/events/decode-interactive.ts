import type { Proto } from 'zapo-js'

export type NativeFormField = {
  screen: string | null
  type: string | null
  name: string
  label: string | null
  value: unknown
  sensitive: boolean
}
export type InteractiveDetails =
  | { selectedId: string | null; displayText: string | null }
  | { name: string | null; params: unknown }
  | {
      name: string | null
      params: unknown
      flowId: string | null
      flowName: string | null
      title: string | null
      fields: NativeFormField[]
      answers: Record<string, unknown>
      flowToken?: string
    }
  | { title: string | null; price: number | null; currency: string | null }
  | { title: string | null; items: number | null; total: number | null; currency: string | null }
export type DecodedInteractive = { type: string; body: string | null; details?: InteractiveDetails }

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}
function join(parts: (string | number | null | undefined)[]): string | null {
  return parts.filter((value) => value !== null && value !== undefined && value !== '').join(' · ') || null
}
function selection(
  type: string,
  id: string | null | undefined,
  displayText: string | null | undefined,
): DecodedInteractive {
  return { type, body: join([id, displayText]), details: { selectedId: id ?? null, displayText: displayText ?? null } }
}
function formFields(params: unknown): NativeFormField[] {
  const response = record(parseJson(record(record(params).wa_flow_response_params).response_message))
  if (!Array.isArray(response.screens)) return []
  return response.screens.flatMap((screenValue) => {
    const screen = record(screenValue)
    if (!Array.isArray(screen.components)) return []
    return screen.components.flatMap((value) => {
      const component = record(value)
      const name = text(component.name)
      return name
        ? [
            {
              screen: text(screen.id),
              type: text(component.type),
              name,
              label: text(component.label),
              value: component.value ?? null,
              sensitive: component.isSensitive === true,
            },
          ]
        : []
    })
  })
}
function quotedFlowToken(quoted: Proto.IMessage | null | undefined): string | undefined {
  let message = quoted
  for (let depth = 0; depth < 8 && message; depth++) {
    for (const button of message.interactiveMessage?.nativeFlowMessage?.buttons ?? []) {
      if (button.name !== 'galaxy_message') continue
      const token = text(record(parseJson(button.buttonParamsJson)).flow_token)
      if (token) return token
    }
    message =
      message.documentWithCaptionMessage?.message ??
      message.viewOnceMessage?.message ??
      message.viewOnceMessageV2?.message ??
      message.ephemeralMessage?.message
  }
  return undefined
}
function nativeResponse(response: Proto.Message.IInteractiveResponseMessage): DecodedInteractive | null {
  const native = response.nativeFlowResponseMessage
  if (!native) return null
  const name = native.name ?? null
  const params = parseJson(native.paramsJson)
  if (name !== 'galaxy_message')
    return {
      type: 'native_flow_response',
      body: join([response.body?.text, name, params === null ? null : JSON.stringify(params)]),
      details: { name, params },
    }
  const form = record(record(params).wa_flow_response_params)
  const fields = formFields(params)
  const token = quotedFlowToken(response.contextInfo?.quotedMessage)
  return {
    type: 'native_form_response',
    body: join([
      text(form.title) ?? response.body?.text,
      ...fields.map(
        (field) =>
          `${field.label ?? field.name}: ${typeof field.value === 'string' ? field.value : JSON.stringify(field.value)}`,
      ),
    ]),
    details: {
      name,
      params,
      flowId: text(form.flow_id),
      flowName: text(form.flow_name),
      title: text(form.title),
      fields,
      answers: Object.fromEntries(fields.map((field) => [field.name, field.value])),
      ...(token ? { flowToken: token } : {}),
    },
  }
}
function amount(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number / 1000 : null
}

/** App-facing summaries, leaving transport and existing decoder branches alone. */
export function decodeInteractive(input: Proto.IMessage): DecodedInteractive | null {
  if (!input || typeof input !== 'object') return null
  const message = input.documentWithCaptionMessage?.message ?? input
  if (message.buttonsMessage) return { type: 'buttons', body: message.buttonsMessage.contentText ?? null }
  if (message.listMessage)
    return { type: 'list', body: join([message.listMessage.title, message.listMessage.description]) }
  const buttons = message.buttonsResponseMessage
  if (buttons) return selection('buttons_response', buttons.selectedButtonId, buttons.selectedDisplayText)
  const list = message.listResponseMessage
  if (list) return selection('list_response', list.singleSelectReply?.selectedRowId, list.title ?? list.description)
  const template = message.templateButtonReplyMessage
  if (template) return selection('template_reply', template.selectedId, template.selectedDisplayText)
  if (message.interactiveResponseMessage) return nativeResponse(message.interactiveResponseMessage)
  const interactive = message.interactiveMessage
  if (interactive?.carouselMessage)
    return {
      type: 'carousel',
      body: join([
        interactive.body?.text,
        ...(interactive.carouselMessage.cards?.map((card) => card.body?.text) ?? []),
      ]),
    }
  if (interactive?.nativeFlowMessage) {
    const button = interactive.nativeFlowMessage.buttons?.[0]
    return {
      type: button?.name === 'single_select' ? 'list' : 'interactive',
      body: interactive.body?.text ?? button?.name ?? null,
      details: { name: button?.name ?? null, params: parseJson(button?.buttonParamsJson) },
    }
  }
  const product = message.productMessage?.product
  if (product) {
    const details = {
      title: product.title ?? null,
      price: amount(product.salePriceAmount1000 ?? product.priceAmount1000),
      currency: product.currencyCode ?? null,
    }
    return { type: 'product', body: join([details.title, details.price, details.currency]), details }
  }
  const order = message.orderMessage
  if (order) {
    const details = {
      title: order.orderTitle ?? order.message ?? null,
      items: order.itemCount ?? null,
      total: amount(order.totalAmount1000),
      currency: order.totalCurrencyCode ?? null,
    }
    return {
      type: 'order',
      body: join([
        details.title,
        details.items === null ? null : `${details.items} items`,
        details.total,
        details.currency,
      ]),
      details,
    }
  }
  return null
}
