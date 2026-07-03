import { ImportTester } from "@/components/import-tester"
import { ArrowLeftRight } from "lucide-react"

export default function Page() {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-5 md:px-6">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ArrowLeftRight className="size-5" />
          </div>
          <div>
            <h1 className="text-balance text-xl font-semibold tracking-tight">
              Vesti → UP Zero Import Tester
            </h1>
            <p className="text-sm text-muted-foreground">
              Teste a integração de catálogo entre as APIs da Vesti e da UP Zero.
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
        <ImportTester />
      </div>
    </main>
  )
}
