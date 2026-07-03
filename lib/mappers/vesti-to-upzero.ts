// Mapeamento genérico de Vesti -> UP Zero.
// Quando um campo não existir na origem, mantemos null para ficar visível na interface.

type AnyRecord = Record<string, any>

function pick(obj: AnyRecord, keys: string[]): any {
  if (!obj || typeof obj !== "object") return null
  for (const key of keys) {
    const value = obj[key]
    if (value !== undefined && value !== null && value !== "") {
      return value
    }
  }
  return null
}

function slugify(value: string | null): string | null {
  if (!value) return null
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

export interface UpzeroCategory {
  name: string | null
  slug: string | null
  external_id: string | null
  parent_external_id: string | null
}

export interface UpzeroProduct {
  name: string | null
  description: string | null
  sku: string | null
  price: number | null
  promotional_price: number | null
  category_external_id: string | null
  images: any[] | null
  variants: any[] | null
  stock: number | null
  status: string | null
  external_id: string | null
}

export function mapVestiCategoryToUpzero(category: AnyRecord): UpzeroCategory {
  const name = pick(category, ["name", "title", "nome", "label"])
  return {
    name,
    slug: pick(category, ["slug"]) ?? slugify(name),
    external_id: pick(category, ["external_id", "id", "code", "codigo"])?.toString() ?? null,
    parent_external_id:
      pick(category, ["parent_external_id", "parent_id", "parentId", "parent"])?.toString() ?? null,
  }
}

function toNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function mapVestiProductToUpzero(product: AnyRecord): UpzeroProduct {
  return {
    name: pick(product, ["name", "title", "nome", "titulo"]),
    description: pick(product, ["description", "descricao", "desc", "details"]),
    sku: pick(product, ["sku", "reference", "code", "referencia", "codigo"])?.toString() ?? null,
    price: toNumber(pick(product, ["price", "preco", "value", "valor"])),
    promotional_price: toNumber(
      pick(product, ["promotional_price", "promo_price", "sale_price", "preco_promocional"]),
    ),
    category_external_id:
      pick(product, ["category_external_id", "category_id", "categoryId", "category"])?.toString() ??
      null,
    images: (pick(product, ["images", "imagens", "photos", "pictures"]) as any[]) ?? null,
    variants: (pick(product, ["variants", "variacoes", "variations", "skus"]) as any[]) ?? null,
    stock: toNumber(pick(product, ["stock", "estoque", "quantity", "qty", "quantidade"])),
    status: pick(product, ["status", "active", "situacao"])?.toString() ?? null,
    external_id: pick(product, ["external_id", "id", "code", "codigo"])?.toString() ?? null,
  }
}
