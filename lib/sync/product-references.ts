export function referenceKey(value: unknown): string {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR")
}

export function parseProductReferences(input: string | string[]): string[] {
  const values = Array.isArray(input) ? input : input.split(/[\n,;]+/)
  const seen = new Set<string>()
  const references: string[] = []

  for (const value of values) {
    if (typeof value !== "string") throw new Error("As referências devem ser textos.")
    const reference = value.trim()
    const key = referenceKey(reference)
    if (!key || seen.has(key)) continue
    seen.add(key)
    references.push(reference)
  }

  return references
}

export function selectProductsByReferences<T extends { code?: unknown; integration_id?: unknown }>(
  products: T[],
  references: string[],
): { products: T[]; missing: string[] } {
  const requested = new Set(references.map(referenceKey))
  const found = new Set<string>()
  const selected: T[] = []

  for (const product of products) {
    const keys = [referenceKey(product.code), referenceKey(product.integration_id)]
    if (!keys.some((key) => requested.has(key))) continue
    selected.push(product)
    keys.forEach((key) => {
      if (requested.has(key)) found.add(key)
    })
  }

  return {
    products: selected,
    missing: references.filter((reference) => !found.has(referenceKey(reference))),
  }
}
