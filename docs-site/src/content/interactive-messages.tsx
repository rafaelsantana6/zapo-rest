import { CodeBlock } from '../components/CodeBlock'

type Locale = 'pt' | 'en' | 'es'
const copy = {
  pt: {
    title: 'Mensagens interativas e Business',
    intro:
      'Oito POSTs com chave de instância, o mesmo destinatário to do envio de texto e resposta { id, result }. Protos isolados por formato; zapo-js cuida de messageSecret, biz e upload criptografado. Veja os exemplos e schemas completos no OpenAPI.',
    route: 'Rota',
    input: 'Corpo e limites',
    buttons:
      'to, text, footer?, buttons: [{ id?, text }], groupSafe?. De 1 a 3 botões de resposta, com header EMPTY e documentWithCaptionMessage.',
    interactive:
      'to, body, footer?, header? (texto), buttons (1–3), groupSafe?. Tipos: quick_reply {id?, text}; url {text, url, webview?}; copy {text, code}; call {text, phoneNumber}; catalog {productId?}. Webview usa apresentação full e interação habilitada. Catálogo usa o PN da própria conta, nunca LID.',
    list: 'to, body, footer?, buttonText, sections: [{title, rows:[{id?, title, description?}]}]. Native flow single_select. Limites da API: 1–10 seções, cada uma com linhas, máximo 10 linhas no total. IDs padrão incluem os índices da seção e da linha.',
    carousel:
      'to, body, cards: [{media: {url}|{base64}, mediaType?: image|video, title?, body, buttons}]. Limites da API: 2–10 cards, 1–3 botões por card. Imagem por padrão; mimetype opcional em media; download com limite de bytes e proteção SSRF, seguido de client.message.upload. O resolvedor 1.11 não produz biz addon para carousel: entrega/renderização em aparelhos exige verificação e pode depender de correção upstream. Card só de catálogo pode sumir no celular; inclua antes um botão url (https://wa.me/c/<PN próprio>).',
    form: 'to, flowId, body?, cta? (Open form), formType? (template), screen?, data?, flowToken?. Formulário criado no app Business do celular, somente 1:1 (grupos/broadcasts: 400). Token ausente gera UUID, retornado como flowToken. galaxy_message v3 usa biz mixed v9 automaticamente: substituir o biz por galaxy_message causa 405 em dispositivo vinculado.',
    pix: 'to, merchantName, key, keyType?, reference?, body?, footer?. Cartão de chave estática payment_info. Tipos inferidos: EMAIL, PHONE E.164 com +, CPF (11 dígitos), CNPJ (14) ou EVP (UUID). Valida formato, não titularidade/aceitação bancária.',
    charge:
      'Campos PIX + reference e items:[{name, amount, quantity}]. subtotal?, total?, discount?, shipping?, tax?. BRL em unidades principais, até 2 casas: 49.90 → {value:4990, offset:100}. Subtotal = soma de preço unitário × quantidade; total = subtotal − desconto + frete + imposto. Totais informados devem coincidir. O envio do cartão não inicia transferência.',
    product:
      'to, productId, title, description, currencyCode, priceAmount1000, salePriceAmount1000?, retailerId?, url?, productImage?: {url}|{base64}, productImageCount?, businessOwnerJid?. PN próprio por padrão. Preços em milésimos: 49900 = BRL 49,90; imagem opcional é enviada antes. Só renderiza um produto real no catálogo daquele negócio; IDs arbitrários não criam produtos.',
    validation:
      'IDs explícitos de resposta devem ser únicos na mensagem, inclusive entre seções e cards; duplicatas retornam 400. IDs gerados reservam os explícitos e recebem sufixos _2, _3… em colisões. Base64/data URI devem ser válidos e não vazios (base64 sem padding é aceito); downloads vazios retornam 400. Conteúdo não reconhecido exige mimetype no pedido ou na data URI; Content-Type do download não basta. A detecção tem precedência. MIME declarado é metadado, não validação de decodificação/renderização.',
    safe: 'Resposta rápida em grupo publica a escolha para todo o grupo. groupSafe: true em buttons/interactive converte apenas respostas rápidas de grupos em cta_url: https://wa.me/<PN próprio>?text=<texto codificado>. O participante abre o privado e envia o texto, sem o ID de resposta original. Padrão: sem conversão; 1:1 mantém quick_reply. Ausência de PN próprio retorna 503 em catálogo, link privado e produto sem owner explícito.',
    pending:
      'catalog_message avulso está pendente de correção upstream: zapo-js 1.11 escolhe biz mixed e o celular mostra não suportado. Use catalog (cta_catalog) em /messages/interactive ou em um carousel, observando as ressalvas acima. Os limites de listas/carrosséis são limites conservadores da API; o guia raw e os handlers de referência não especificam máximos para esses formatos.',
    inbound:
      'Os eventos existentes message, message.any e message.inbound (webhooks/SSE) incluem types buttons, list, interactive, carousel, product, order, buttons_response, list_response, template_reply, native_flow_response e native_form_response. body traz resumo legível; interactive traz {selectedId, displayText}, {name, params} (JSON interpretado, nome do primeiro botão), preço/moeda do produto ou quantidade/total do pedido. Formulários incluem flowId, flowName, title, fields:[{screen,type,name,label,value,sensitive}], answers:{nome:valor} e flowToken quando presente na mensagem citada. JSON inválido preserva a mensagem com detalhes vazios/nulos. Sem novos nomes de eventos.',
    design: 'Proto interativo isolado por formato; respostas privadas em grupo por opção',
    benefit:
      'Upstream mantém segredos, biz e criptografia. groupSafe usa o PN próprio; builders podem migrar para a API tipada sem mudar as rotas.',
    references:
      'Referências de wire: guia oficial e tipos de mensagem. Evidência de campos de aparelhos foi consultada no AstraCalls (AGPL-3.0), sem copiar código, comentários ou estrutura.',
  },
  en: {
    title: 'Interactive and Business messages',
    intro:
      'Eight POSTs with an instance key, the same to recipient handling as text, and { id, result } responses. Proto builders are isolated per format; zapo-js owns messageSecret, biz and encrypted uploads. See OpenAPI for full schemas and examples.',
    route: 'Route',
    input: 'Body and limits',
    buttons:
      'to, text, footer?, buttons: [{ id?, text }], groupSafe?. 1–3 response buttons, EMPTY header and documentWithCaptionMessage wrapper.',
    interactive:
      'to, body, footer?, header? (text), buttons (1–3), groupSafe?. Types: quick_reply {id?, text}; url {text, url, webview?}; copy {text, code}; call {text, phoneNumber}; catalog {productId?}. Webview enables full presentation and interaction. Catalog uses the own account PN, never LID.',
    list: 'to, body, footer?, buttonText, sections:[{title, rows:[{id?, title, description?}]}]. Native flow single_select. API bounds: 1–10 nonempty sections, at most 10 rows total. Generated IDs contain both section and row indexes.',
    carousel:
      'to, body, cards:[{media:{url}|{base64}, mediaType?: image|video, title?, body, buttons}]. API bounds: 2–10 cards, 1–3 buttons each. Defaults to image; optional mimetype in media; bounded SSRF-protected downloads then client.message.upload. The 1.11 resolver produces no carousel biz addon: device delivery/rendering needs verification and may require an upstream fix. Catalog-only cards may disappear on mobile; put a url button first (https://wa.me/c/<own PN>).',
    form: 'to, flowId, body?, cta? (Open form), formType? (template), screen?, data?, flowToken?. A form created in the phone Business app, 1:1 only (groups/broadcasts: 400). Missing token generates a UUID returned as flowToken. galaxy_message v3 automatically uses biz mixed v9: replacing that biz name with galaxy_message causes linked-device 405.',
    pix: 'to, merchantName, key, keyType?, reference?, body?, footer?. Static-key payment_info card. Inferred types: EMAIL, E.164 PHONE with +, CPF (11 digits), CNPJ (14), EVP (UUID). Checks format, not ownership/bank acceptance.',
    charge:
      'PIX fields + reference and items:[{name, amount, quantity}]. subtotal?, total?, discount?, shipping?, tax?. BRL in major units, max 2 decimals: 49.90 → {value:4990, offset:100}. Subtotal = sum of unit price × quantity; total = subtotal − discount + shipping + tax. Supplied totals must match. Sending a card does not initiate a transfer.',
    product:
      'to, productId, title, description, currencyCode, priceAmount1000, salePriceAmount1000?, retailerId?, url?, productImage?:{url}|{base64}, productImageCount?, businessOwnerJid?. Defaults to own PN. Prices in thousandths: 49900 = BRL 49.90; optional image uploaded first. Only a real product in that business catalog renders; arbitrary IDs do not create products.',
    validation:
      'Explicit reply IDs must be unique across the message, including sections/cards; duplicates return 400. Generated IDs reserve explicit IDs and gain _2, _3… suffixes on collision. Base64/data URIs must be valid and nonempty (unpadded base64 accepted); empty downloads return 400. Unknown content requires mimetype in the request or data URI; a download Content-Type alone is insufficient. Detection takes precedence. A declared MIME is metadata, not decoding/rendering validation.',
    safe: 'A group quick reply posts the choice to the whole group. groupSafe: true on buttons/interactive converts only group quick replies to cta_url: https://wa.me/<own PN>?text=<encoded text>. The participant opens a private chat and sends the text, without the original reply ID. Default: no conversion; 1:1 keeps quick_reply. Missing own PN returns 503 for catalog, private links and products without an explicit owner.',
    pending:
      'Standalone catalog_message awaits an upstream fix: zapo-js 1.11 chooses biz mixed and phones show unsupported. Use catalog (cta_catalog) in /messages/interactive or a carousel, with the caveats above. List/carousel limits are conservative API bounds; the supplied raw guide and reference handlers do not specify maxima for these formats.',
    inbound:
      'Existing message, message.any and message.inbound events (webhooks/SSE) include types buttons, list, interactive, carousel, product, order, buttons_response, list_response, template_reply, native_flow_response and native_form_response. body is readable; interactive holds {selectedId, displayText}, {name, params} (parsed JSON, first button name), product price/currency or order item count/total. Forms add flowId, flowName, title, fields:[{screen,type,name,label,value,sensitive}], answers:{name:value} and flowToken when present in the quoted message. Invalid JSON preserves the message with empty/null details. No new event names.',
    design: 'Interactive proto isolated per format; opt-in private group replies',
    benefit:
      'Upstream owns secrets, biz and encryption. groupSafe uses own PN; builders can migrate to the typed API without changing routes.',
    references:
      'Wire references: official guide and message types. Phone field evidence was inspected in AstraCalls (AGPL-3.0) without copying code, comments or implementation structure.',
  },
  es: {
    title: 'Mensajes interactivos y Business',
    intro:
      'Ocho POST con clave de instancia, el mismo destinatario to que texto y respuesta { id, result }. Protos aislados por formato; zapo-js controla messageSecret, biz y cargas cifradas. Consulte OpenAPI para los schemas y ejemplos completos.',
    route: 'Ruta',
    input: 'Cuerpo y límites',
    buttons:
      'to, text, footer?, buttons:[{id?, text}], groupSafe?. 1–3 botones de respuesta, header EMPTY y envoltura documentWithCaptionMessage.',
    interactive:
      'to, body, footer?, header? (texto), buttons (1–3), groupSafe?. Tipos: quick_reply {id?, text}; url {text, url, webview?}; copy {text, code}; call {text, phoneNumber}; catalog {productId?}. Webview habilita presentación full e interacción. Catálogo usa el PN propio, nunca LID.',
    list: 'to, body, footer?, buttonText, sections:[{title, rows:[{id?, title, description?}]}]. Native flow single_select. Límites API: 1–10 secciones no vacías, máximo 10 filas en total. IDs generados incluyen índices de sección y fila.',
    carousel:
      'to, body, cards:[{media:{url}|{base64}, mediaType?: image|video, title?, body, buttons}]. Límites API: 2–10 tarjetas, 1–3 botones cada una. Imagen por defecto; mimetype opcional en media; descargas limitadas y protegidas contra SSRF, luego client.message.upload. El resolvedor 1.11 no genera biz addon para carousel: entrega/renderización en dispositivos requiere verificación y puede depender de una corrección upstream. Tarjetas solo de catálogo pueden desaparecer en móvil; incluya primero un botón url (https://wa.me/c/<PN propio>).',
    form: 'to, flowId, body?, cta? (Open form), formType? (template), screen?, data?, flowToken?. Formulario creado en la app Business del teléfono, solo 1:1 (grupos/broadcasts: 400). Sin token genera UUID, devuelto como flowToken. galaxy_message v3 usa automáticamente biz mixed v9: cambiar el biz por galaxy_message causa 405 en un dispositivo vinculado.',
    pix: 'to, merchantName, key, keyType?, reference?, body?, footer?. Tarjeta de clave estática payment_info. Tipos inferidos: EMAIL, PHONE E.164 con +, CPF (11 dígitos), CNPJ (14), EVP (UUID). Valida formato, no titularidad/aceptación bancaria.',
    charge:
      'Campos PIX + reference e items:[{name, amount, quantity}]. subtotal?, total?, discount?, shipping?, tax?. BRL en unidades principales, hasta 2 decimales: 49.90 → {value:4990, offset:100}. Subtotal = suma de precio unitario × cantidad; total = subtotal − descuento + envío + impuesto. Totales informados deben coincidir. Enviar una tarjeta no inicia una transferencia.',
    product:
      'to, productId, title, description, currencyCode, priceAmount1000, salePriceAmount1000?, retailerId?, url?, productImage?:{url}|{base64}, productImageCount?, businessOwnerJid?. PN propio por defecto. Precios en milésimas: 49900 = BRL 49,90; imagen opcional cargada antes. Solo muestra un producto real en el catálogo de ese negocio; IDs arbitrarios no crean productos.',
    validation:
      'IDs explícitos de respuesta deben ser únicos en el mensaje, incluso entre secciones/tarjetas; duplicados devuelven 400. IDs generados reservan los explícitos y añaden sufijos _2, _3… ante colisión. Base64/data URI deben ser válidos y no vacíos (base64 sin padding aceptado); descargas vacías devuelven 400. Contenido desconocido requiere mimetype en el pedido o data URI; Content-Type de descarga no basta. Detección tiene prioridad. MIME declarado es metadato, no validación de decodificación/renderización.',
    safe: 'Una respuesta rápida en grupo publica la elección para todo el grupo. groupSafe: true en buttons/interactive convierte solo respuestas rápidas de grupos a cta_url: https://wa.me/<PN propio>?text=<texto codificado>. El participante abre un privado y envía el texto, sin el ID original. Por defecto sin conversión; 1:1 conserva quick_reply. PN propio ausente devuelve 503 para catálogo, enlaces privados y productos sin propietario explícito.',
    pending:
      'catalog_message independiente espera corrección upstream: zapo-js 1.11 selecciona biz mixed y el teléfono muestra no compatible. Use catalog (cta_catalog) en /messages/interactive o un carousel, con las limitaciones anteriores. Límites de listas/carousel son límites conservadores de la API; la guía raw y los handlers de referencia no especifican máximos para estos formatos.',
    inbound:
      'Eventos existentes message, message.any y message.inbound (webhooks/SSE) incluyen tipos buttons, list, interactive, carousel, product, order, buttons_response, list_response, template_reply, native_flow_response y native_form_response. body es legible; interactive incluye {selectedId, displayText}, {name, params} (JSON interpretado, nombre del primer botón), precio/moneda del producto o cantidad/total del pedido. Formularios añaden flowId, flowName, title, fields:[{screen,type,name,label,value,sensitive}], answers:{nombre:valor} y flowToken cuando existe en el mensaje citado. JSON inválido conserva el mensaje con detalles vacíos/nulos. Sin nuevos nombres de eventos.',
    design: 'Proto interactivo aislado por formato; respuestas privadas en grupo opcionales',
    benefit:
      'Upstream controla secretos, biz y cifrado. groupSafe usa el PN propio; builders pueden migrar a la API tipada sin cambiar rutas.',
    references:
      'Referencias wire: guía oficial y tipos de mensaje. Se consultaron campos de teléfonos en AstraCalls (AGPL-3.0), sin copiar código, comentarios ni estructura.',
  },
}
const routes = ['buttons', 'interactive', 'list', 'carousel', 'native-form', 'pix', 'charge', 'product'] as const
const keys = ['buttons', 'interactive', 'list', 'carousel', 'form', 'pix', 'charge', 'product'] as const

export function InteractiveMessagesGuide({ locale }: { locale: Locale }) {
  const t = copy[locale]
  return (
    <section aria-labelledby="interactive-business">
      <h2 id="interactive-business">{t.title}</h2>
      <p>{t.intro}</p>
      <table>
        <thead>
          <tr>
            <th>{t.route}</th>
            <th>{t.input}</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((route, index) => (
            <tr key={route}>
              <td>
                <code>POST /v1/messages/{route}</code>
              </td>
              <td>{t[keys[index]]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{t.validation}</p>
      <p>{t.safe}</p>
      <p>{t.pending}</p>
      <CodeBlock
        language="json"
        code={JSON.stringify(
          {
            to: '5511999999999',
            body: 'Choose',
            groupSafe: true,
            buttons: [
              { type: 'quick_reply', id: 'yes', text: 'Yes' },
              { type: 'url', text: 'Open', url: 'https://example.com', webview: true },
            ],
          },
          null,
          2,
        )}
      />
      <p>{t.inbound}</p>
      <p>
        {t.references} <a href="https://zapo.to/en/guides/raw-sends">Raw sends</a> ·{' '}
        <a href="https://zapo.to/en/reference/message-types">Message types</a> ·{' '}
        <a href="https://github.com/AstraOnlineWeb/AstraCalls">AstraCalls</a>
      </p>
    </section>
  )
}
export function InteractiveWebhookGuide({ locale }: { locale: Locale }) {
  return <p>{copy[locale].inbound}</p>
}
export function InteractiveDesignRow({ locale }: { locale: Locale }) {
  return (
    <tr>
      <td>{copy[locale].design}</td>
      <td>{copy[locale].benefit}</td>
    </tr>
  )
}
