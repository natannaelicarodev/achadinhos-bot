import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionResult } from "@/app/painel/canais/actions";

export function ActionMessage({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <div className="grid gap-2">
      {result.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      ) : null}
      {result.success ? (
        <Alert role="status">
          <AlertDescription>{result.success}</AlertDescription>
        </Alert>
      ) : null}
      {result.warning ? (
        <Alert role="status" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
          <AlertDescription>{result.warning}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
