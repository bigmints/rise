import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { api } from "@/lib/api";
import { RiseLogo } from "@/components/rise-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginApp() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/session", { method: "POST", body: JSON.stringify({ password }) });
      window.location.replace("/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not sign in");
      setBusy(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_35%)]" />
      <Card className="relative w-full max-w-md border-border/80 bg-card/90 shadow-2xl backdrop-blur">
        <CardHeader className="space-y-7 p-6 sm:p-8">
          <RiseLogo />
          <div className="space-y-2">
            <div className="flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground"><LockKeyhole className="size-4" /></div>
            <CardTitle className="font-display text-4xl font-normal">Welcome back.</CardTitle>
            <CardDescription>Your health record.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-0 sm:p-8 sm:pt-0">
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus required />
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button className="h-11 w-full" disabled={busy} type="submit">{busy ? "Opening…" : "Open Rise"}<ArrowRight /></Button>
          </form>
          <p className="mt-6 text-center text-xs text-muted-foreground">Your information stays private.</p>
        </CardContent>
      </Card>
    </main>
  );
}
