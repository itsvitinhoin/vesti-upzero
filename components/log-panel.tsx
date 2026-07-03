"use client"

import type { LogEntry } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { JsonViewer } from "@/components/json-viewer"
import { Trash2, ArrowRight } from "lucide-react"

function statusVariant(entry: LogEntry): "default" | "secondary" | "destructive" {
  if (!entry.ok) return "destructive"
  return "default"
}

interface LogPanelProps {
  logs: LogEntry[]
  onClear: () => void
}

export function LogPanel({ logs, onClear }: LogPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Logs de requisições</h2>
          <p className="text-xs text-muted-foreground">{logs.length} chamada(s) registrada(s)</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={logs.length === 0}
          className="gap-1.5 text-muted-foreground"
        >
          <Trash2 className="size-3.5" />
          Limpar
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {logs.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhuma requisição ainda. Use os botões para testar as APIs.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {logs.map((log) => (
              <li key={log.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(log)} className="font-mono">
                      {log.status || "ERR"}
                    </Badge>
                    <span className="font-medium">{log.label}</span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">{log.durationMs}ms</span>
                </div>

                <div className="mt-2 grid gap-1 font-mono text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-20 text-foreground">Método</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                      {log.method}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-20 text-foreground">Endpoint</span>
                    <ArrowRight className="size-3 shrink-0" />
                    <span className="truncate">{log.url || log.requestSummary || "(sem URL)"}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-20 text-foreground">Status</span>
                    <span>{log.status || "ERR"}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{log.durationMs}ms</span>
                  </div>
                </div>

                {log.error ? (
                  <p className="mt-1.5 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
                    {log.error}
                  </p>
                ) : null}

                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{log.timestamp}</span>
                  <JsonViewer
                    title={`Resposta JSON · ${log.label}`}
                    data={log.responseBody}
                    triggerLabel="Ver resposta JSON"
                    variant="ghost"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
