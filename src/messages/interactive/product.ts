import type { Proto } from 'zapo-js'
import type { z } from 'zod'
import type { SendProductBodySchema } from '~/http/interactive-schemas'

export function buildProduct(
  input: z.infer<typeof SendProductBodySchema>,
  businessOwnerJid: string,
  productImage?: Proto.Message.IImageMessage,
): Proto.IMessage {
  return {
    productMessage: {
      businessOwnerJid,
      product: {
        productId: input.productId,
        title: input.title,
        description: input.description,
        currencyCode: input.currencyCode,
        priceAmount1000: input.priceAmount1000,
        ...(input.salePriceAmount1000 !== undefined ? { salePriceAmount1000: input.salePriceAmount1000 } : {}),
        ...(input.retailerId !== undefined ? { retailerId: input.retailerId } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(productImage
          ? { productImage, productImageCount: input.productImageCount ?? 1 }
          : input.productImageCount
            ? { productImageCount: input.productImageCount }
            : {}),
      },
    },
  }
}
