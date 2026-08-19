"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { fetchTodaysStatuses, statusFromString } from "@/lib/team";
import type { MemberWithStatus, Status } from "@/lib/types";

// Laster inn team-medlemmer + dagens statuser fra databasen. Gir også en reload-
// funksjon som kan kalles etter mutasjoner.
export function useTeamSnapshot(teamId: string | null) {
  const [members, setMembers] = useState<MemberWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload(supabase: SupabaseClient, team: string, signal?: AbortSignal) {
    try {
      const { listMembers } = await import("@/lib/team");
      const [memberList, statusMap] = await Promise.all([
        listMembers(supabase, team),
        fetchTodaysStatuses(supabase, team),
      ]);
      if (signal?.aborted) return;
      const today = new Date().toISOString().slice(0, 10);
      const combined = memberList.map((member) => {
        const status = statusMap.get(member.id);
        return {
          ...member,
          status: status?.status ?? ("Ikke startet" as Status),
          arrivalOrder: status?.arrivalOrder,
          updated: status ? (status.updatedAt.slice(0, 10) === today ? "i dag" : "i går") : "i dag",
        } satisfies MemberWithStatus;
      });
      setMembers(combined);
      setError(null);
    } catch (caught) {
      if (signal?.aborted) return;
      setError(caught instanceof Error ? caught.message : "Kunne ikke hente teamet.");
    }
  }

  useEffect(() => {
    // Dette er et klassisk "load når id endrer seg"-mønster — vi må sette state
    // for å reflektere den nye id-en. Vi demper kaskade-renders med queueMicrotask.
    /* eslint-disable react-hooks/set-state-in-effect */
    const controller = new AbortController();
    if (!teamId) {
      queueMicrotask(() => {
        setMembers([]);
        setLoading(false);
      });
      return () => controller.abort();
    }
    const supabase = createClient();
    if (!supabase) {
      queueMicrotask(() => {
        setError("Supabase er ikke konfigurert.");
        setLoading(false);
      });
      return () => controller.abort();
    }
    queueMicrotask(() => setLoading(true));
    const finish = () => {
      if (!controller.signal.aborted) queueMicrotask(() => setLoading(false));
    };
    void reload(supabase, teamId, controller.signal).finally(finish);
    // Hvis teamId endrer eller komponent unmountes, avbryt pågående last
    // slik at vi ikke overskriver state med stale data.
    return () => controller.abort();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [teamId]);

  // Returnerer en reload-funksjon med valgfritt teamId-argument for bakover-
// kompatibilitet med kall som `reload(supabase, teamId)`. Bruker kontekstuell
// teamId hvis ikke oppgitt.
  const reloadBound = useCallback((supabase: SupabaseClient, explicitTeamId?: string) => {
    const target = explicitTeamId ?? teamId;
    if (!target) return Promise.resolve();
    return reload(supabase, target);
  }, [teamId]);

  return { members, loading, error, reload: reloadBound };
}

// Lytter på realtime-endringer i status_updates og oppdaterer lokal state.
// Vi merger innkommende rader i stedet for å gjøre en full reload — det er
// raskere og føles mer "live".
export function useStatusRealtime(
  teamId: string | null,
  onChange: (memberId: string, status: Status) => void,
) {
  useEffect(() => {
    if (!teamId) return;
    const supabase = createClient();
    if (!supabase) return;
    const channel = supabase
      .channel(`status-${teamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "status_updates", filter: `team_id=eq.${teamId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as {
            member_id?: string;
            status?: string;
            arrival_order?: number | null;
          };
          if (!row.member_id || !row.status) return;
          onChange(row.member_id, statusFromString(row.status));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [teamId, onChange]);
}

// Spiller av en kort to-tone-notifikasjon når en card-request er til deg.
// Lyd må aktiveres eksplisitt av brukeren (browser-policy).
export function useNotificationSound() {
  const contextRef = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);

  function enable() {
    if (!contextRef.current) {
      try {
        contextRef.current = new AudioContext();
        void contextRef.current.resume();
      } catch {
        return;
      }
    }
    setEnabled(true);
  }

  function play() {
    const context = contextRef.current;
    if (!context) return;
    const tone = (at: number, frequency: number) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.16);
    };
    const now = context.currentTime;
    tone(now, 880);
    tone(now + 0.2, 1175);
  }

  return { enabled, enable, play };
}

// Lytter på nye kortforespørsler og kaller onRequest() for hver nye rad som
// ikke allerede er resolved. Brukes både for lyd og UI-varsling.
export function useCardRequestRealtime(
  teamId: string | null,
  onRequest: (request: { id: string; fromMemberId: string; toMemberId: string }) => void,
) {
  useEffect(() => {
    if (!teamId) return;
    const supabase = createClient();
    if (!supabase) return;
    const channel = supabase
      .channel(`requests-${teamId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "card_requests", filter: `team_id=eq.${teamId}` },
        (payload) => {
          const row = payload.new as {
            id?: string;
            from_member_id?: string;
            to_member_id?: string;
          };
          if (!row.id || !row.from_member_id || !row.to_member_id) return;
          onRequest({ id: row.id, fromMemberId: row.from_member_id, toMemberId: row.to_member_id });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [teamId, onRequest]);
}

// Prøver å vise et OS-nivå-varsel uten service worker. Returnerer `granted`
// hvis tillatelse er gitt, ellers `denied`/`default`. Lovet på nyere nettlesere;
// ingen VAPID eller service worker nødvendig — fungerer bare mens appen er åpen.
export async function ensureNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  const result = await Notification.requestPermission();
  return result;
}

export function showSystemNotification(title: string, body: string, onClick?: () => void) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const notification = new Notification(title, {
    body,
    icon: "/icon.png",
    badge: "/icon.png",
    tag: "card-request",
    // Krev at brukeren aktivt trykker på varselet for å fjerne det — disse
    // er tidssensitive ("klar til å slippe deg inn") og må ikke forsvinne
    // før brukeren ser dem.
    requireInteraction: true,
    silent: false,
  });
  if (onClick) {
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  }
  // Auto-lukk etter 30 sekunder som en sikkerhetsventil hvis brukeren ignorerer.
  setTimeout(() => notification.close(), 30_000);
}

export function vibrate(pattern: number | number[] = [200, 100, 200]) {
  if (typeof window === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // No-op: enkelte nettlesere kaster hvis brukeren ikke har interagert.
  }
}

// Setter app-ikon-badge (Android/Chrome, macOS Safari støtter det ikke).
// null fjerner badge. count === 0 gjør ingenting (lar forrige badge stå hvis
// det er en).
export function setAppBadge(count: number | null) {
  if (typeof navigator === "undefined") return;
  const badge = (navigator as Navigator & { setAppBadge?: (n: number) => Promise<void> }).setAppBadge;
  const clear = (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge;
  if (count === null && typeof clear === "function") {
    void clear.call(navigator);
    return;
  }
  if (typeof count === "number" && count > 0 && typeof badge === "function") {
    void badge.call(navigator, count);
  } else if (count === 0 && typeof clear === "function") {
    void clear.call(navigator);
  }
}

// Sjekker hver minutt om datoen har byttet, og kaller onDayChange() når den gjør det.
// Bruker en ref slik at onDayChange kan endre seg mellom renders uten å re-binde
// intervallet (slik unngår vi en resettingssyklus som ellers ville blitt trigget
// av ny referanse fra f.eks. useTeamSnapshot.reload).
export function useDayChange(onDayChange: () => void) {
  const callbackRef = useRef(onDayChange);
  useEffect(() => { callbackRef.current = onDayChange; }, [onDayChange]);
  useEffect(() => {
    const today = () => new Intl.DateTimeFormat("en-CA").format(new Date());
    let current = today();
    const interval = window.setInterval(() => {
      const next = today();
      if (next !== current) {
        current = next;
        callbackRef.current();
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);
}

// Holder Supabase-session i live ved å refreshe tokenet hvert 5. minutt.
// proxy.ts refresher ved hver request, men hvis brukeren holder appen åpen
// uten å navigere, kan access-token utløpe og realtime-WebSocket kobles ut.
export function useSessionKeepalive() {
  useEffect(() => {
    const refresh = async () => {
      const supabase = createClient();
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        const expiresAt = data.session.expires_at;
        // Hvis token utløper innen 60 sekunder, refresh nå.
        if (expiresAt && expiresAt * 1000 - Date.now() < 60_000) {
          await supabase.auth.refreshSession();
        }
      }
    };
    // Sjekk oftere enn refresh-intervallet for å fange opp token som holder
    // på å utløpe.
    const interval = window.setInterval(refresh, 60_000);
    // Også refresh når siden blir synlig igjen etter å ha vært i bakgrunnen.
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
