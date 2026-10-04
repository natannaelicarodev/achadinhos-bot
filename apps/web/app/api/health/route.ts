// Rota de teste: GET /api/health
export function GET() {
  return Response.json({ ok: true, servico: "web" });
}
