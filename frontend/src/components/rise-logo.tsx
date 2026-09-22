import { Sparkles } from "lucide-react";

export function RiseLogo({ compact = false }: { compact?: boolean }) {
  return (
    <a href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight sm:gap-2.5" aria-label="Rise home">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground sm:size-9 sm:rounded-xl"><Sparkles className="size-4" /></span>
      {!compact && <span className="text-base sm:text-lg">Rise</span>}
    </a>
  );
}
