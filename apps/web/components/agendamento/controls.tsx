"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  devPickNowAction,
  pauseChannelAction,
  resumeChannelAction,
  resumeStoreAction,
  type ActionResult,
} from "@/app/painel/agendamento/actions";
import { Button } from "@/components/ui/button";

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (task: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await task();
      setFeedback(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      router.refresh();
    });
  return { pending, feedback, run };
}

function Feedback({ feedback }: { feedback: { ok: boolean; text: string } | null }) {
  return feedback ? <span className={feedback.ok ? "text-xs text-green-700" : "text-xs text-destructive"}>{feedback.text}</span> : null;
}

/** Pausar / retomar os envios de um número. */
export function ChannelPauseButton({ channelId, paused }: { channelId: string; paused: boolean }) {
  const { pending, feedback, run } = useAction();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={paused ? "default" : "outline"}
        disabled={pending}
        onClick={() => run(() => (paused ? resumeChannelAction(channelId) : pauseChannelAction(channelId)))}
      >
        {paused ? "Retomar" : "Pausar"}
      </Button>
      <Feedback feedback={feedback} />
    </span>
  );
}

export function ResumeStoreButton({ store }: { store: string }) {
  const { pending, feedback, run } = useAction();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => resumeStoreAction(store))}>
        Retomar loja
      </Button>
      <Feedback feedback={feedback} />
    </span>
  );
}

/** Só no modo acelerado (desenvolvimento): força o piloto a escolher já. */
export function DevPickNowButton() {
  const { pending, feedback, run } = useAction();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(devPickNowAction)}>
        Escolher oferta agora (teste)
      </Button>
      <Feedback feedback={feedback} />
    </span>
  );
}

/** Atualiza a fila sozinha (a cada 15 s; 5 s no modo acelerado). */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
