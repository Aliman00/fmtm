"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, type ReactNode, useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Mode = "register" | "login";
type Step = "details" | "code";

type AuthGateProps = {
  children: (user: User) => ReactNode;
};

export default function AuthGate({ children }: AuthGateProps) {
  const configured = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!configured);
  const [mode, setMode] = useState<Mode>("register");
  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, [configured]);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;
    if (mode === "register" && !displayName.trim()) {
      setError("Skriv inn et navn eller nickname.");
      return;
    }
    setBusy(true);
    setError("");
    const supabase = createClient();
    if (!supabase) {
      setError("Tilkoblingen til Supabase er ikke konfigurert.");
      setBusy(false);
      return;
    }
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: mode === "register"
        ? { data: { display_name: displayName.trim() } }
        : { shouldCreateUser: false },
    });
    setBusy(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    setStep("code");
    setMessage("Vi har sendt en kode til " + email.trim() + ".");
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    if (!supabase) {
      setError("Tilkoblingen til Supabase er ikke konfigurert.");
      setBusy(false);
      return;
    }
    const { error: authError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (authError) setError("Koden er feil eller har utløpt. Prøv igjen.");
  }

  if (!ready) return <main className="auth-shell"><p className="auth-loading">Laster inn …</p></main>;
  if (user) return <>{children(user)}</>;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand"><span>↗</span><p>FØRSTE MANN TIL MØLLA</p></div>
        <h1>{step === "code" ? "Sjekk e-posten din" : mode === "register" ? "Velkommen til gjengen" : "Velkommen tilbake"}</h1>
        <p className="auth-intro">{step === "code" ? "Skriv inn koden du fikk tilsendt." : "Koordiner kortbyttet uten meldingskaos."}</p>

        {!configured ? (
          <div className="auth-error"><b>Koblingen mangler</b><p>Legg Supabase-URL og publiserbar nøkkel inn i <code>.env.local</code>, basert på <code>.env.local.example</code>, og start utviklingsserveren på nytt.</p></div>
        ) : step === "details" ? (
          <form onSubmit={sendCode} className="auth-form">
            {mode === "register" && <label>Navn eller nickname<input value={displayName} onChange={(event) => setDisplayName(event.target.value.slice(0, 40))} placeholder="F.eks. Mia" autoComplete="nickname" maxLength={40} /></label>}
            <label>E-postadresse<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="navn@firma.no" type="email" autoComplete="email" required /></label>
            {error && <p className="auth-error">{error}</p>}
            <button className="auth-primary" disabled={busy}>{busy ? "Sender kode …" : "Send engangskode"}</button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="auth-form">
            <label>Engangskode<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="one-time-code" placeholder="12345678" maxLength={8} autoFocus required /></label>
            {message && <p className="auth-note">{message}</p>}
            {error && <p className="auth-error">{error}</p>}
            <button className="auth-primary" disabled={busy || code.length < 6}>{busy ? "Sjekker kode …" : "Logg inn"}</button>
            <button type="button" className="auth-secondary" onClick={() => { setStep("details"); setCode(""); setError(""); }}>Bruk en annen e-post</button>
          </form>
        )}

        {step === "details" && <button className="auth-switch" onClick={() => { setMode((current) => current === "register" ? "login" : "register"); setError(""); }}>{mode === "register" ? "Har du allerede en bruker? Logg inn" : "Ny her? Opprett bruker"}</button>}
      </section>
    </main>
  );
}
