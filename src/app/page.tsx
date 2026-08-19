"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import AuthGate from "./auth-gate";
import { createClient } from "@/lib/supabase/client";
import { ensureTeamMembership } from "@/lib/team";
import { firstNameOf } from "@/lib/types";
import { friendlyError } from "@/lib/errors";
import Dashboard from "./dashboard";

export default function Home() {
  return <AuthGate>{(user) => <Authenticated user={user} />}</AuthGate>;
}

function Authenticated({ user }: { user: User }) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    const initialName =
      (user.user_metadata.display_name as string | undefined)?.trim() || user.email?.split("@")[0] || "Kollega";

    // refreshSession() sikrer at access-token er friskt nok til å passere RLS.
    void supabase.auth.refreshSession().finally(() => {
      void ensureTeamMembership(supabase, user.id, initialName)
        .then(({ teamId: id, memberId: mId }) => {
          setTeamId(id);
          setMemberId(mId);
        })
        .catch((caught: unknown) => {
          console.error("ensureTeamMembership failed:", caught);
          setError(friendlyError(caught, "Kunne ikke koble til teamet."));
        })
        .finally(() => queueMicrotask(() => setLoading(false)));
    });
  }, [user.id, user.email, user.user_metadata.display_name]);

  const userLabel = firstNameOf(
    (user.user_metadata.display_name as string | undefined)?.trim() || user.email?.split("@")[0] || "Kollega",
  );

  if (loading) return <main className="auth-shell"><p className="auth-loading">Kobler til teamet …</p></main>;
  if (error || !teamId || !memberId)
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-brand"><span>↗</span><p>FØRSTE MANN TIL MØLLA</p></div>
          <h1>Noe gikk galt</h1>
          <p className="auth-error"><b>Kunne ikke koble til teamet.</b><br />{error ?? "Mangler team-tilkobling."}</p>
          <button className="auth-primary" onClick={() => window.location.reload()}>Prøv igjen</button>
        </section>
      </main>
    );
  return <Dashboard user={user} teamId={teamId} memberId={memberId} userLabel={userLabel} />;
}
