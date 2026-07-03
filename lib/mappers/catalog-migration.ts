type AnyRecord = Record<string, any>

export const VESTI_INTEGRATION = "vesti"

export interface UpzeroExternalRef {
  integration: string
  external_id: string
}

export interface UpzeroAttributeTermPayload {
  code: string
  name: string
  sort_order?: number
  rgb?: string
  meta?: Record<string, unknown>
}

export interface UpzeroVariantPayload {
  id?: string
  external_ref: UpzeroExternalRef
  sku: string
  barcode?: string | null
  price: string
  promotional_price?: string | null
  cost?: string | null
  attributes: Array<{
    attribute: { name: string; code: string }
    term: { name: string; code: string }
  }>
  active: boolean
}

export interface UpzeroProductPayload {
  external_ref: UpzeroExternalRef
  code: string
  name: string
  description_html?: string
  status: "active" | "inactive" | "archived"
  tags: string[]
  category_ids: string[]
  category_names?: string[]
  product_category_ids?: string[]
  product_category_names?: string[]
  variants: UpzeroVariantPayload[]
}

export interface UpzeroCategoryPayload {
  name: string
  status: boolean
  slug?: string
  is_featured?: boolean
  sort_order?: number
  parent_id?: number | null
  parent_external_id?: string | null
  external_ref: UpzeroExternalRef
}

export interface InventorySetPayload {
  movement_type: "SET"
  sku: string
  qty: number
  price?: string
  promotional_price?: string
  note: string
  reference: {
    reference_type: "ADJUSTMENT"
    reference_id: string
  }
}

export interface ProductImagePayload {
  url: string
  fallback_urls?: string[]
  attributes?: Array<{
    attribute: { name: string; code: string }
    term: { name: string; code: string }
  }>
  display_order: number
  is_primary: boolean
}

export interface ProductVideoPayload {
  url: string
  name?: string
  attributes?: ProductImagePayload["attributes"]
}

function cleanString(value: unknown): string {
  return String(value ?? "").trim()
}

function nullableString(value: unknown): string | null {
  const text = cleanString(value)
  return text ? text : null
}

export function normalizeRgb(value: unknown): string | null {
  const text = nullableString(value)
  if (!text) return null

  const withoutHash = text.replace(/^#/, "")
  if (/^[0-9A-Fa-f]{3}$/.test(withoutHash)) {
    return `#${withoutHash
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`.toUpperCase()
  }

  return /^[0-9A-Fa-f]{6}$/.test(withoutHash) ? `#${withoutHash}`.toUpperCase() : null
}

function decimalString(value: unknown, fallback = "0.00"): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n.toFixed(2)
}

function intValue(value: unknown, fallback = 0): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.floor(n))
}

function firstUrl(...values: unknown[]): string | null {
  for (const value of values) {
    const text = nullableString(value)
    if (text && /^https?:\/\//i.test(text)) return text
  }
  return null
}

function mediaUrl(media: AnyRecord) {
  return firstUrl(
    media?.original?.url,
    media?.zoom?.url,
    media?.large?.url,
    media?.normal?.url,
    media?.medium?.url,
    media?.small?.url,
    media?.image?.url,
    media?.file?.url,
    media?.url,
    media?.image_url,
    media?.imageLink,
    media?.image_link,
    media?.src,
    media?.source,
    media?.href,
  )
}

function uniqueUrls(values: Array<string | null | undefined>): string[] {
  const urls: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const url = nullableString(value)
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }

  return urls
}

function vestiOriginalImageUrl(url: string): string | null {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (!/(^|\.)vesti\.mobi$/i.test(parsed.hostname)) return null

  const upgradedPath = parsed.pathname.replace(
    /-(?:lg|md|sm|xs|thumb|large|medium|small)\.(?:webp|jpe?g|png)$/i,
    "-og.jpeg",
  )

  if (upgradedPath === parsed.pathname) return null
  parsed.pathname = upgradedPath
  return parsed.toString()
}

function vestiResizedImageUrls(url: string): string[] {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return []
  }

  if (!/(^|\.)vesti\.mobi$/i.test(parsed.hostname)) return []

  const match = parsed.pathname.match(/-(og|lg|md|sm|xs|thumb|large|medium|small)\.(webp|jpe?g|png)$/i)
  if (!match) return []

  const candidates: string[] = []
  for (const suffix of ["lg", "md", "sm"]) {
    for (const extension of ["webp", "jpeg"]) {
      const next = new URL(parsed.toString())
      next.pathname = parsed.pathname.replace(
        /-(og|lg|md|sm|xs|thumb|large|medium|small)\.(webp|jpe?g|png)$/i,
        `-${suffix}.${extension}`,
      )
      candidates.push(next.toString())
    }
  }

  return candidates
}

function imageUrlCandidates(url: string): string[] {
  return uniqueUrls([vestiOriginalImageUrl(url), url, ...vestiResizedImageUrls(url)])
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/i.test(url)
}

function mediaLooksLikeVideo(media: AnyRecord, url: string) {
  const type = cleanString(
    media.content_type ??
      media.contentType ??
      media.mime_type ??
      media.mimeType ??
      media.type ??
      media.file?.content_type ??
      media.file?.mime_type,
  ).toLowerCase()
  return type.startsWith("video/") || isVideoUrl(url)
}

function htmlDescription(product: AnyRecord): string | undefined {
  const html = nullableString(product.full_description)
  if (html) return html

  const description = nullableString(product.description)
  if (!description) return undefined

  return `<p>${description
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</p>`
}

function externalRef(externalId: unknown): UpzeroExternalRef {
  return {
    integration: VESTI_INTEGRATION,
    external_id: cleanString(externalId),
  }
}

function stableCode(value: unknown, fallback: unknown): string {
  const code = nullableString(value)
  if (code) return code
  return cleanString(fallback)
}

function categoryExternalId(category: AnyRecord): string {
  return stableCode(
    category.id || category.integration_id || category.code || category.slug,
    category.name || category.title || category.label,
  )
}

function slugText(value: unknown, fallback: unknown): string {
  return stableCode(value, fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

function productTags(product: AnyRecord): string[] {
  const sourceTags = Array.isArray(product.tags) ? product.tags : []
  return Array.from(
    new Set(
      sourceTags
        .map((tag: unknown) => typeof tag === "string" ? tag : cleanString((tag as AnyRecord)?.name ?? (tag as AnyRecord)?.label))
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  )
}

function variantSku(productCode: string, stock: AnyRecord): string {
  return stableCode(stock.sku, `${productCode}-${stock.id ?? "sku"}`)
}

function termCode(value: unknown, fallback: unknown): string {
  return stableCode(value, fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80)
}

function normalizedTermKey(value: unknown): string {
  return termCode(value, "")
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/(^-|-$)/g, "")
}

function meaningfulColorName(value: unknown): string | null {
  const text = nullableString(value)
  if (!text) return null
  const normalized = normalizedTermKey(text)
  if (!normalized || normalized === "cor" || normalized === "color" || normalized === "cores" || normalized === "colors") {
    return null
  }
  return text
}

function colorDisplayName(color: AnyRecord): string | null {
  return (
    meaningfulColorName(color.name) ??
    meaningfulColorName(color.title) ??
    meaningfulColorName(color.label) ??
    meaningfulColorName(color.color_name) ??
    meaningfulColorName(color.description) ??
    meaningfulColorName(color.code)
  )
}

function mergeColorContext(color: AnyRecord | undefined, fallback: AnyRecord): AnyRecord {
  const colorName = colorDisplayName(color ?? {})
  const fallbackName = colorDisplayName(fallback)
  const rgb = normalizeRgb(color?.code ?? color?.rgb ?? color?.hex ?? fallback.code ?? fallback.rgb ?? fallback.hex)

  return {
    ...(color ?? {}),
    ...fallback,
    id: color?.id ?? fallback.id,
    integration_id: color?.integration_id ?? fallback.integration_id,
    name: colorName ?? fallbackName ?? color?.name ?? fallback.name,
    code: rgb ?? color?.code ?? fallback.code,
    rgb: rgb ?? color?.rgb ?? fallback.rgb,
    hex: rgb ?? color?.hex ?? fallback.hex,
  }
}

function colorById(product: AnyRecord): Map<string, AnyRecord> {
  return new Map((product.colors ?? []).map((color: AnyRecord) => [cleanString(color.id), color]))
}

function sizeById(product: AnyRecord): Map<string, AnyRecord> {
  return new Map((product.sizes ?? []).map((size: AnyRecord) => [cleanString(size.id), size]))
}

export function mapVestiCategoryForMigration(category: AnyRecord): UpzeroCategoryPayload {
  const name = cleanString(category.name || category.title || category.label || "Categoria sem nome")
  return {
    name,
    status: category.active !== false && category.status !== false,
    slug: slugText(category.slug || category.code, name),
    is_featured: Boolean(category.is_featured || category.featured),
    sort_order: intValue(category.sort_order ?? category.position ?? category.order, 0),
    parent_id: null,
    parent_external_id: nullableString(category.parent_list_id || category.parent_id || category.parent_external_id),
    external_ref: externalRef(categoryExternalId(category)),
  }
}

export function mapVestiColorTerm(color: AnyRecord, sortOrder = 0): UpzeroAttributeTermPayload {
  const rgb = normalizeRgb(color.code ?? color.rgb ?? color.hex)
  const name = colorDisplayName(color) ?? cleanString(color.name || color.code || "Cor")
  const canonicalCode = termCode(name, color.integration_id || color.id)

  return {
    code: canonicalCode,
    name,
    sort_order: sortOrder,
    rgb: rgb ?? undefined,
    meta: {
      vesti_id: nullableString(color.id),
      vesti_code: nullableString(color.integration_id || color.id),
      rgb,
    },
  }
}

export function mapVestiSizeTerm(size: AnyRecord, sortOrder = 0): UpzeroAttributeTermPayload {
  return {
    code: termCode(size.slug || size.name, size.id),
    name: cleanString(size.name || "Tamanho"),
    sort_order: sortOrder,
    meta: {
      vesti_id: nullableString(size.id),
      slug: nullableString(size.slug),
    },
  }
}

export function mapVestiProductForMigration(product: AnyRecord): UpzeroProductPayload {
  const colors = colorById(product)
  const sizes = sizeById(product)
  const productCode = stableCode(product.code || product.integration_id, product.id)

  return {
    external_ref: externalRef(product.id || productCode),
    code: productCode,
    name: cleanString(product.name || productCode),
    description_html: htmlDescription(product),
    status: product.active === false || product.status === false ? "inactive" : "active",
    tags: productTags(product),
    category_ids: (product.categories ?? [])
      .map((category: AnyRecord) => categoryExternalId(category))
      .filter(Boolean),
    variants: (product.stocks ?? []).map((stock: AnyRecord) => {
      const color = colors.get(cleanString(stock.color_id))
      const size = sizes.get(cleanString(stock.size_id))
      const colorTerm = mapVestiColorTerm(mergeColorContext(color, { id: stock.color_id, name: stock.color_name, code: stock.color_code }))
      const sizeTerm = mapVestiSizeTerm(size ?? { id: stock.size_id, name: stock.size_name })

      return {
        external_ref: externalRef(stock.id || stock.sku),
        sku: variantSku(productCode, stock),
        barcode: nullableString(stock.barcode),
        price: decimalString(stock.price ?? product.price),
        promotional_price:
          Number(stock.price_promotional ?? product.price_promotional ?? 0) > 0
            ? decimalString(stock.price_promotional ?? product.price_promotional)
            : null,
        cost: null,
        attributes: [
          {
            attribute: { name: "Cor", code: "color" },
            term: { name: colorTerm.name, code: colorTerm.code },
          },
          {
            attribute: { name: "Tamanho", code: "size" },
            term: { name: sizeTerm.name, code: sizeTerm.code },
          },
        ],
        active: stock.active !== false && stock.status !== false,
      }
    }),
  }
}

export function mapVestiInventoryForMigration(product: AnyRecord): InventorySetPayload[] {
  const productCode = stableCode(product.code || product.integration_id, product.id)

  return (product.stocks ?? []).map((stock: AnyRecord) => ({
    movement_type: "SET",
    sku: variantSku(productCode, stock),
    qty: intValue(stock.quantity),
    price: decimalString(stock.price ?? product.price),
    promotional_price:
      Number(stock.price_promotional ?? product.price_promotional ?? 0) > 0
        ? decimalString(stock.price_promotional ?? product.price_promotional)
        : "0",
    note: "Sincronizacao Vesti",
    reference: {
      reference_type: "ADJUSTMENT",
      reference_id: cleanString(product.id || product.code),
    },
  }))
}

export function mapVestiImagesForMigration(product: AnyRecord): ProductImagePayload[] {
  const colors = colorById(product)
  const sizes = sizeById(product)
  const images = new Map<string, ProductImagePayload>()

  const mediaAttributes = (media: AnyRecord): ProductImagePayload["attributes"] => {
    const attributes: NonNullable<ProductImagePayload["attributes"]> = []
    const color = colors.get(cleanString(media.color_id ?? media.color?.id))
    const size = sizes.get(cleanString(media.size_id ?? media.size?.id))

    if (color || media.color_id || media.color_name || media.color_code || media.color?.name) {
      const term = mapVestiColorTerm(
        mergeColorContext(color, {
          id: media.color_id ?? media.color?.id,
          name: media.color_name ?? media.color?.name,
          code: media.color_code ?? media.color?.code,
        }),
      )
      attributes.push({
        attribute: { name: "Cor", code: "color" },
        term: { name: term.name, code: term.code },
      })
    }

    if (size || media.size_id || media.size_name || media.size?.name) {
      const term = mapVestiSizeTerm(
        size ?? {
          id: media.size_id ?? media.size?.id,
          name: media.size_name ?? media.size?.name,
        },
      )
      attributes.push({
        attribute: { name: "Tamanho", code: "size" },
        term: { name: term.name, code: term.code },
      })
    }

    return attributes.length ? attributes : undefined
  }

  const addImage = (media: unknown, primary = false) => {
    if (!media) return
    const item = typeof media === "string" ? { url: media } : media
    if (typeof item !== "object") return
    const sourceUrl = mediaUrl(item as AnyRecord)
    if (sourceUrl && mediaLooksLikeVideo(item as AnyRecord, sourceUrl)) return
    if (!sourceUrl) return

    const [url, ...fallbackUrls] = imageUrlCandidates(sourceUrl)
    if (!url || images.has(url)) return

    images.set(url, {
      url,
      fallback_urls: fallbackUrls.length ? fallbackUrls : undefined,
      attributes: mediaAttributes(item as AnyRecord),
      display_order: images.size,
      is_primary: primary && images.size === 0,
    })
  }

  const visitMedia = (value: unknown, primary = false, depth = 0) => {
    if (!value || depth > 4) return
    if (typeof value === "string") {
      addImage(value, primary)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visitMedia(item, primary && images.size === 0, depth + 1)
      return
    }
    if (typeof value !== "object") return

    addImage(value, primary)
    const item = value as AnyRecord
    for (const key of [
      "media",
      "medias",
      "images",
      "image",
      "imagens",
      "photos",
      "pictures",
      "gallery",
      "galleries",
      "attachments",
      "files",
      "items",
      "variants",
      "colors",
      "stocks",
    ]) {
      if (item[key]) visitMedia(item[key], false, depth + 1)
    }
  }

  visitMedia(product.main_media, true)
  visitMedia(product.main_image, true)
  visitMedia(product.image, true)
  visitMedia(product.thumbnail, true)
  visitMedia(product.photo, true)
  visitMedia(product.media)
  visitMedia(product.medias)
  visitMedia(product.images)
  visitMedia(product.imagens)
  visitMedia(product.photos)
  visitMedia(product.pictures)
  visitMedia(product.gallery)
  visitMedia(product.galleries)
  visitMedia(product.colors)
  visitMedia(product.stocks)

  return Array.from(images.values()).map((image, index) => ({
    ...image,
    display_order: index,
    is_primary: index === 0,
  }))
}

export function mapVestiVideosForMigration(product: AnyRecord): ProductVideoPayload[] {
  const videos = new Map<string, ProductVideoPayload>()
  const colors = colorById(product)
  const sizes = sizeById(product)

  const mediaAttributes = (media: AnyRecord): ProductImagePayload["attributes"] => {
    const attributes: NonNullable<ProductImagePayload["attributes"]> = []
    const color = colors.get(cleanString(media.color_id ?? media.color?.id))
    const size = sizes.get(cleanString(media.size_id ?? media.size?.id))

    if (color || media.color_id || media.color_name || media.color_code || media.color?.name) {
      const term = mapVestiColorTerm(
        mergeColorContext(color, {
          id: media.color_id ?? media.color?.id,
          name: media.color_name ?? media.color?.name,
          code: media.color_code ?? media.color?.code,
        }),
      )
      attributes.push({
        attribute: { name: "Cor", code: "color" },
        term: { name: term.name, code: term.code },
      })
    }

    if (size || media.size_id || media.size_name || media.size?.name) {
      const term = mapVestiSizeTerm(
        size ?? {
          id: media.size_id ?? media.size?.id,
          name: media.size_name ?? media.size?.name,
        },
      )
      attributes.push({
        attribute: { name: "Tamanho", code: "size" },
        term: { name: term.name, code: term.code },
      })
    }

    return attributes.length ? attributes : undefined
  }

  const addVideo = (media: unknown) => {
    if (!media) return
    const item = typeof media === "string" ? { url: media } : media
    if (typeof item !== "object") return
    const record = item as AnyRecord
    const url = mediaUrl(record)
    if (!url || !mediaLooksLikeVideo(record, url) || videos.has(url)) return
    videos.set(url, {
      url,
      name: nullableString(record.name ?? record.title ?? record.label ?? record.file_name) ?? undefined,
      attributes: mediaAttributes(record),
    })
  }

  const visitMedia = (value: unknown, depth = 0) => {
    if (!value || depth > 4) return
    if (typeof value === "string") {
      addVideo(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visitMedia(item, depth + 1)
      return
    }
    if (typeof value !== "object") return

    addVideo(value)
    const item = value as AnyRecord
    for (const key of [
      "media",
      "medias",
      "videos",
      "video",
      "images",
      "image",
      "imagens",
      "photos",
      "pictures",
      "gallery",
      "galleries",
      "attachments",
      "files",
      "items",
      "variants",
      "colors",
      "stocks",
    ]) {
      if (item[key]) visitMedia(item[key], depth + 1)
    }
  }

  visitMedia(product.main_media)
  visitMedia(product.video)
  visitMedia(product.videos)
  visitMedia(product.media)
  visitMedia(product.medias)
  visitMedia(product.images)
  visitMedia(product.imagens)
  visitMedia(product.photos)
  visitMedia(product.pictures)
  visitMedia(product.gallery)
  visitMedia(product.galleries)
  visitMedia(product.colors)
  visitMedia(product.stocks)

  return Array.from(videos.values())
}

export function collectTermsFromProducts(products: AnyRecord[]) {
  const colors = new Map<string, UpzeroAttributeTermPayload>()
  const sizes = new Map<string, UpzeroAttributeTermPayload>()
  let colorOrder = 0
  let sizeOrder = 0

  const addColor = (color: AnyRecord) => {
    const term = mapVestiColorTerm(color, colorOrder)
    if (!colorDisplayName(color) && !normalizeRgb(color.code ?? color.rgb ?? color.hex)) return
    if (!colors.has(term.code)) {
      colors.set(term.code, term)
      colorOrder += 1
    }
  }

  const addSize = (size: AnyRecord) => {
    const term = mapVestiSizeTerm(size, sizeOrder)
    if (!sizes.has(term.code)) {
      sizes.set(term.code, term)
      sizeOrder += 1
    }
  }

  for (const product of products) {
    for (const size of product.sizes ?? []) {
      addSize(size)
    }
    for (const stock of product.stocks ?? []) {
      if (stock.color_id || stock.color_name || stock.color_code) {
        const color = colorById(product).get(cleanString(stock.color_id))
        addColor(mergeColorContext(color, {
          id: stock.color_id,
          name: stock.color_name,
          code: stock.color_code,
        }))
      }
      if (stock.size_id || stock.size_name) {
        addSize({
          id: stock.size_id,
          name: stock.size_name,
        })
      }
    }
  }

  return {
    colors: Array.from(colors.values()),
    sizes: Array.from(sizes.values()),
  }
}
