import assert from "node:assert/strict"
import { test } from "node:test"
import { parseProductReferences, selectProductsByReferences } from "../lib/sync/product-references"

test("parses references without losing punctuation or leading zeroes", () => {
  assert.deepEqual(
    parseProductReferences("00123\n13.425; ABC-7,00123\nabc-7"),
    ["00123", "13.425", "ABC-7"],
  )
})

test("selects only exact Vesti references and reports missing entries", () => {
  const products = [
    { code: "00123", id: "a" },
    { code: "123", id: "b" },
    { code: "13.425", id: "c" },
    { code: "ABC-7", id: "d" },
  ]
  const result = selectProductsByReferences(products, ["00123", "13.425", "999"])

  assert.deepEqual(result.products.map((product) => product.id), ["a", "c"])
  assert.deepEqual(result.missing, ["999"])
})

test("matches integration_id when the product code differs", () => {
  const result = selectProductsByReferences(
    [{ code: "ERP-1", integration_id: "VESTI-42" }],
    ["vesti-42"],
  )

  assert.equal(result.products.length, 1)
  assert.deepEqual(result.missing, [])
})

test("rejects non-text entries in a reference list", () => {
  assert.throws(() => parseProductReferences(["00123", 42] as unknown as string[]))
})
