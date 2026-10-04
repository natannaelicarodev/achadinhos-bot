import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-bold">Achadinhos Bot</h1>
      <p className="text-muted-foreground">Fase 0: esqueleto funcionando.</p>
      <Button>Botão shadcn/ui</Button>
    </main>
  );
}
