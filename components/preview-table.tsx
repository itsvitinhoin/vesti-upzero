"use client"

import {
  mapVestiProductToUpzero,
  mapVestiCategoryToUpzero,
} from "@/lib/mappers/vesti-to-upzero"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { JsonViewer } from "@/components/json-viewer"
import { Send, Loader2 } from "lucide-react"

function cell(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-xs italic text-muted-foreground">null</span>
  }
  return <span>{String(value)}</span>
}

interface PreviewTableProps {
  kind: "product" | "category"
  items: any[]
  sendingId: string | null
  onSend: (rawItem: any) => void
}

export function PreviewTable({ kind, items, sendingId, onSend }: PreviewTableProps) {
  if (items.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-muted-foreground">
        Nenhum item carregado. Use os botões de busca acima.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">ID externo</th>
            <th className="px-3 py-2 font-medium">Nome</th>
            {kind === "product" ? (
              <>
                <th className="px-3 py-2 font-medium">SKU/Ref</th>
                <th className="px-3 py-2 font-medium">Categoria</th>
                <th className="px-3 py-2 font-medium">Preço</th>
                <th className="px-3 py-2 font-medium">Estoque</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </>
            ) : (
              <>
                <th className="px-3 py-2 font-medium">Slug</th>
                <th className="px-3 py-2 font-medium">Pai (ext.)</th>
              </>
            )}
            <th className="px-3 py-2 text-right font-medium">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((raw, index) => {
            if (kind === "product") {
              const m = mapVestiProductToUpzero(raw)
              const id = m.external_id ?? `idx-${index}`
              return (
                <tr key={id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{cell(m.external_id)}</td>
                  <td className="px-3 py-2">{cell(m.name)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{cell(m.sku)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{cell(m.category_external_id)}</td>
                  <td className="px-3 py-2">{cell(m.price)}</td>
                  <td className="px-3 py-2">{cell(m.stock)}</td>
                  <td className="px-3 py-2">
                    {m.status ? <Badge variant="secondary">{m.status}</Badge> : cell(null)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <JsonViewer title="Produto (bruto da Vesti)" data={raw} />
                      <JsonViewer
                        title="Produto mapeado (UP Zero)"
                        data={m}
                        triggerLabel="Mapeado"
                        variant="ghost"
                      />
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={sendingId === id}
                        onClick={() => onSend(raw)}
                      >
                        {sendingId === id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Send className="size-3.5" />
                        )}
                        Enviar
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            }

            const m = mapVestiCategoryToUpzero(raw)
            const id = m.external_id ?? `idx-${index}`
            return (
              <tr key={id} className="hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{cell(m.external_id)}</td>
                <td className="px-3 py-2">{cell(m.name)}</td>
                <td className="px-3 py-2 font-mono text-xs">{cell(m.slug)}</td>
                <td className="px-3 py-2 font-mono text-xs">{cell(m.parent_external_id)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <JsonViewer title="Categoria (bruta da Vesti)" data={raw} />
                    <JsonViewer
                      title="Categoria mapeada (UP Zero)"
                      data={m}
                      triggerLabel="Mapeado"
                      variant="ghost"
                    />
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={sendingId === id}
                      onClick={() => onSend(raw)}
                    >
                      {sendingId === id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Send className="size-3.5" />
                      )}
                      Enviar
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
