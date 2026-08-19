"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  appendActivity,
  createCardRequest,
  fetchLatestCardRequest,
  fetchRecentActivity,
  resolveCardRequest,
  updateMemberProfile,
  upsertStatus,
} from "@/lib/team";
import {
  STATUSES,
  STATUS_META,
  firstNameOf,
  type ActivityEvent,
  type CardRequest,
  type MemberWithStatus,
  type Status,
} from "@/lib/types";
import {
  ensureNotificationPermission,
  setAppBadge,
  showSystemNotification,
  useCardRequestRealtime,
  useDayChange,
  useNotificationSound,
  useSessionKeepalive,
  useStatusRealtime,
  useTeamSnapshot,
  vibrate,
} from "./hooks";
import { friendlyError } from "@/lib/errors";

type DashboardProps = {
  user: User;
  teamId: string;
  memberId: string;
  userLabel: string;
};

export default function Dashboard({ user, teamId, memberId, userLabel }: DashboardProps) {
  const supabase = createClient() as SupabaseClient;
  const { members, loading, error, reload } = useTeamSnapshot(teamId);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [request, setRequest] = useState<CardRequest | null>(null);
  const [message, setMessage] = useState("Du er på vei — god tur!");
  const [showUserMenu, setShowUserMenu] = useState(false);
  const sound = useNotificationSound();

  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState(userLabel);

  // Hent aktivitet og siste forespørsel ved mount.
  useEffect(() => {
    void fetchRecentActivity(supabase, teamId).then(setEvents);
    void fetchLatestCardRequest(supabase, teamId).then(setRequest);
  }, [teamId, supabase]);

  // Realtime: når noen oppdaterer status, oppdater lokal liste og legg til i feeden.
  const handleStatusChange = useCallback(
    (memberId: string, status: Status) => {
      const person = members.find((m) => m.id === memberId);
      const name = person ? firstNameOf(person.name) : "En kollega";
      setEvents((current) => [
        { id: `${memberId}-${Date.now()}`, message: `${name} er ${status.toLowerCase()}`, createdAt: new Date().toISOString() },
        ...current,
      ].slice(0, 4));
      void reload(supabase, teamId);
    },
    [members, reload, supabase, teamId],
  );
  useStatusRealtime(teamId, handleStatusChange);

  // Finn "meg" i medlemslista. Brukes både i realtime-handlers og i render.
  const meResolved = useMemo(
    () => members.find((m) => m.id === memberId) ?? null,
    [members, memberId],
  );

  // Når noen ber om hjelp: hvis forespørselen er til oss, spill lyd, vibrer og
// vis et OS-varsel (i tillegg til toasten i appen).
  const handleIncomingRequest = useCallback(
    (incoming: { id: string; toMemberId: string; fromMemberId: string }) => {
      const meId = members.find((m) => m.id === memberId)?.id ?? null;
      if (incoming.toMemberId !== meId) return;
      sound.enable();
      sound.play();
      vibrate([300, 120, 300]);
      const sender = members.find((m) => m.id === incoming.fromMemberId);
      const senderName = sender ? firstNameOf(sender.name) : "En kollega";
      setRequest({
        id: incoming.id,
        fromMemberId: incoming.fromMemberId,
        toMemberId: incoming.toMemberId,
        createdAt: new Date().toISOString(),
      });
      setEvents((current) => [
        {
          id: incoming.id,
          message: `${senderName} ba deg ta med kortet`,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ].slice(0, 4));
      // OS-varsel fungerer i bakgrunnen også — nyttig hvis brukeren er i en
      // annen fane. Async: try-catch fordi noen plattformer kaster.
      void ensureNotificationPermission().then((permission) => {
        if (permission === "granted") {
          showSystemNotification(
            `${senderName} ber om hjelp`,
            "Vil du ta med kortet ut?",
          );
        }
      });
      // App-badge (Android/Chrome): vis "1" på hjemskjerm-ikonet.
      setAppBadge(1);
    },
    // members + memberId + sound er stabilt nok — sound-objektet endrer seg kun når
    // brukeren trykker på lyd-knappen, og det er da vi vil at effekten skal kjøre
    // igjen uansett.
    [members, memberId, sound],
  );
  useCardRequestRealtime(teamId, handleIncomingRequest);

  // Når dagen bytter: reload (server-side vil gi "Ikke startet" for alle som ikke har oppdatert).
  useDayChange(useCallback(() => { void reload(supabase, teamId); }, [reload, supabase, teamId]));

  // Hold Supabase-session i live så realtime ikke dør etter lang tid i bakgrunnen.
  useSessionKeepalive();

  const onSiteMembers = useMemo(
    () => members.filter((m) => m.status === "På plass"),
    [members],
  );
  const firstOnSite = useMemo(
    () => [...onSiteMembers].sort((a, b) => (a.arrivalOrder ?? Number.MAX_SAFE_INTEGER) - (b.arrivalOrder ?? Number.MAX_SAFE_INTEGER))[0] ?? null,
    [onSiteMembers],
  );
  const firstArrival = useMemo(
    () => [...members].filter((m) => m.arrivalOrder !== undefined).sort((a, b) => (a.arrivalOrder! - b.arrivalOrder!))[0] ?? null,
    [members],
  );
  const progress = useMemo(() => meResolved ? STATUSES.indexOf(meResolved.status) : 0, [meResolved]);

  const incomingAlert = request && request.toMemberId === meResolved?.id
    ? `${members.find((m) => m.id === request.fromMemberId)?.name.split(" ")[0] ?? "En kollega"} ber deg ta med kortet.`
    : null;

  function helperNames() {
    if (onSiteMembers.length === 1) return onSiteMembers[0].name.split(" ")[0];
    if (onSiteMembers.length === 2) return onSiteMembers.map((m) => m.name.split(" ")[0]).join(" og ");
    return `${onSiteMembers.slice(0, 2).map((m) => m.name.split(" ")[0]).join(", ")} og ${onSiteMembers.length - 2} andre`;
  }

  async function updateMyStatus(status: Status) {
    if (!meResolved) return;
    sound.enable();
    if (status === meResolved.status) return;
    const keepsArrivalOrder = status === "På plass" || status === "Gått videre";
    const arrivalOrder = status === "På plass" && meResolved.status !== "På plass"
      ? Math.max(0, ...members.map((m) => m.arrivalOrder ?? 0)) + 1
      : keepsArrivalOrder ? meResolved.arrivalOrder : undefined;
    try {
      await upsertStatus(supabase, teamId, meResolved.id, status, arrivalOrder);
      await appendActivity(supabase, teamId, meResolved.id, `${firstNameOf(meResolved.name)} er ${status.toLowerCase()}`);
      setMessage(
        status === "På plass" ? "Flott! Du er på plass."
          : status === "Gått videre" ? "Du er ikke lenger tilgjengelig for kortforespørsler."
          : `Status oppdatert: ${status}.`,
      );
      await reload(supabase, teamId);
    } catch (caught) {
      console.error("updateMyStatus failed:", caught);
      setMessage(friendlyError(caught, "Kunne ikke oppdatere status."));
    }
  }

  async function requestCard(helper: MemberWithStatus) {
    if (!meResolved) return;
    sound.enable();
    try {
      const created = await createCardRequest(supabase, teamId, meResolved.id, helper.id);
      setRequest({
        id: created.id,
        fromMemberId: created.from_member_id,
        toMemberId: created.to_member_id,
        createdAt: created.created_at,
      });
      await appendActivity(supabase, teamId, meResolved.id, `${firstNameOf(meResolved.name)} ba ${firstNameOf(helper.name)} ta med kortet`);
      setMessage(`Forespørselen er sendt til ${firstNameOf(helper.name)}.`);
      await fetchRecentActivity(supabase, teamId).then(setEvents);
    } catch (caught) {
      console.error("requestCard failed:", caught);
      setMessage(friendlyError(caught, "Kunne ikke sende forespørselen."));
    }
  }

  async function dismissAlert() {
    if (!request) return;
    setRequest(null);
    setAppBadge(null);
    try {
      await resolveCardRequest(supabase, request.id);
      setMessage("Forespørselen er kvittert.");
    } catch (caught) {
      console.error("resolveCardRequest failed:", caught);
      setMessage(friendlyError(caught, "Kunne ikke kvittere forespørselen."));
    }
  }

  async function saveNickname() {
    if (!meResolved) return;
    const nextName = nicknameDraft.trim();
    if (!nextName) return;
    const { error: authError } = await supabase.auth.updateUser({ data: { display_name: nextName } });
    if (authError) {
      console.error("auth.updateUser failed:", authError);
      setMessage(friendlyError(authError, "Kunne ikke oppdatere navnet."));
      return;
    }
    try {
      await updateMemberProfile(supabase, meResolved.id, nextName);
      setEditingNickname(false);
      setMessage("Nickname er oppdatert.");
      await reload(supabase, teamId);
    } catch (caught) {
      console.error("updateMemberProfile failed:", caught);
      setMessage("Nickname er oppdatert hos Supabase Auth, men ikke i teamet.");
    }
  }

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch (caught) {
      console.error("signOut failed:", caught);
      // Fortsett — auth-state-change lytteren kan likevel plukke opp endringen.
    }
  }

  if (loading) return <main className="app-shell"><div className="app-frame"><p className="auth-loading">Laster team …</p></div></main>;
  if (error) return <main className="app-shell"><div className="app-frame"><p className="auth-error">{error}</p></div></main>;
  if (!meResolved) return <main className="app-shell"><div className="app-frame"><p className="auth-loading">Setter deg opp i teamet …</p></div></main>;
  const meMember = meResolved;

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div className="brand-mark" aria-hidden="true">↗</div>
          <div className="topbar-copy"><p className="eyebrow">I DAG</p><h1>Første mann <span>til mølla</span></h1></div>
          <div className="profile-wrap">
            <button className="profile" onClick={() => { sound.enable(); setShowUserMenu((open) => !open); }} aria-label="Åpne profil">{meMember.initials}</button>
            {showUserMenu && (
              <div className="user-menu profile-menu">
                <p>Din profil</p>
                {editingNickname ? (
                  <div className="nickname-edit">
                    <input value={nicknameDraft} onChange={(event) => setNicknameDraft(event.target.value.slice(0, 40))} maxLength={40} autoFocus />
                    <button onClick={saveNickname}>Lagre</button>
                  </div>
                ) : (
                  <>
                    <strong>{userLabel}</strong>
                    <small>{user.email}</small>
                    <button onClick={() => setEditingNickname(true)}>Endre nickname</button>
                    <button onClick={signOut}>Logg ut</button>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        <section className="hero-card">
          <div className="hero-card-top">
            <div><p className="eyebrow">DAGENS OPPDRAG</p><h2>Bytt kort</h2></div>
            <span className="live-pill"><i /> LIVE</span>
          </div>
          <p>Den første som kommer frem kan hjelpe resten av gjengen.</p>
          <div className="hero-footer">
            <div className="mini-avatars" aria-label={`${members.length} teammedlemmer`}>
              {members.map((member) => <span className={`avatar ${member.color}`} key={member.id}>{member.initials}</span>)}
            </div>
            <span>{members.length} på teamet</span>
          </div>
        </section>

        <section className="my-status" aria-labelledby="my-status-title">
          <div className="section-heading">
            <div><p className="eyebrow">DIN STATUS</p><h2 id="my-status-title">Hei, {meMember.name.split(" ")[0]} <span>👋</span></h2></div>
            <span className={`status-badge ${STATUS_META[meMember.status].className}`}><b>{STATUS_META[meMember.status].icon}</b>{meMember.status}</span>
          </div>
          <div className="progress-track" aria-label={`Status: ${meMember.status}`}>
            {STATUSES.map((status, index) => (
              <div className={`progress-step ${index <= progress ? "active" : ""}`} key={status}>
                <span>{index < progress ? "✓" : index + 1}</span>
                <small>{status.replace("Ikke startet", "Start")}</small>
              </div>
            ))}
          </div>
          <div className="status-actions">
            {STATUSES.map((status) => (
              <button
                className={`status-action ${STATUS_META[status].className} ${meMember.status === status ? "selected" : ""}`}
                onClick={() => updateMyStatus(status)}
                key={status}
              >
                <span>{STATUS_META[status].icon}</span>{status}
              </button>
            ))}
          </div>
          <p className="feedback" role="status" aria-live="polite">{message}</p>
          <button className={`sound-toggle ${sound.enabled ? "enabled" : ""}`} onClick={() => { sound.enable(); void ensureNotificationPermission(); }}>🔔 {sound.enabled ? "Lydvarsler er på" : "Slå på lydvarsler"}</button>
        </section>

        <section className="team-section" aria-labelledby="team-title">
          <div className="section-heading compact">
            <div><p className="eyebrow">TEAMET</p><h2 id="team-title">Hvor er alle?</h2></div>
            <span className="count-pill">{members.filter((m) => m.status === "På plass").length} på plass</span>
          </div>
          <div className="member-list">
            {members.map((member) => {
              const meta = STATUS_META[member.status];
              return (
                <article className="member-row" key={member.id}>
                  <span className={`avatar large ${member.color}`}>{member.initials}</span>
                  <div className="member-info">
                    <h3>{member.name}{member.id === meMember.id && <span> (deg)</span>}</h3>
                    <p><i className={meta.className} /> {meta.label} <em>· {member.updated}</em></p>
                  </div>
                  {member.id === firstArrival?.id ? <span className="first-chip">FØRST!</span> : <span className="chevron">›</span>}
                </article>
              );
            })}
          </div>
        </section>

        {firstOnSite && meMember.status === "I nærheten" && (
          <section className="help-card" aria-labelledby="help-title">
            <div className="help-icon">�</div>
            <div className="help-copy">
              <p className="eyebrow">NOEN ER PÅ PLASS</p>
              <h2 id="help-title">{helperNames()} kan hjelpe</h2>
              <p>Du er i nærheten. Send en pling og spør om kortet kan tas med ut.</p>
              <div className="bring-actions">
                {onSiteMembers.map((member) => (
                  <button key={member.id} onClick={() => requestCard(member)}>Be {member.name.split(" ")[0]} ta med kortet mitt</button>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="activity" aria-labelledby="activity-title">
          <p className="eyebrow" id="activity-title">SISTE AKTIVITET</p>
          <ol>
            {events.map((event, index) => (
              <li key={event.id}>
                <i /> <span>{event.message}</span>
                <time>{index === 0 ? "nå" : new Date(event.createdAt).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" })}</time>
              </li>
            ))}
          </ol>
        </section>
        {incomingAlert && (
          <div className="incoming-alert" role="alert">
            <span>🔔</span>
            <div><b>Ny forespørsel</b><p>{incomingAlert}</p></div>
            <button onClick={dismissAlert} aria-label="Lukk varsel">×</button>
          </div>
        )}
      </div>
    </main>
  );
}
