"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Code2 } from "lucide-react"

interface JsonViewerProps {
  title: string
  data: unknown
  triggerLabel?: string
  variant?: "default" | "outline" | "secondary" | "ghost"
  size?: "default" | "sm"
}

export function JsonViewer({
  title,
  data,
  triggerLabel = "Ver JSON",
  variant = "outline",
  size = "sm",
}: JsonViewerProps) {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant={variant} size={size} className="gap-1.5" />}
      >
        <Code2 className="size-3.5" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
          {data === null || data === undefined
            ? "(sem dados)"
            : JSON.stringify(data, null, 2)}
        </pre>
      </DialogContent>
    </Dialog>
  )
}
