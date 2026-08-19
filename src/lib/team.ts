import type { SupabaseClient } from "@supabase/supabase-js";
import { AVATAR_COLORS, initialsFor, type ActivityEvent, type AvatarColor, type CardRequest, type Member, type Status, STATUSES } from "./types";

// Databasen returnerer disse radene — hold dem adskilt fra UI-typene fordi de har
// andre feltnavn og vi vil ikke blande domene og presentasjon.
type MemberRow = {
  id: string;
  team_id: string;
  user_id: string;
  display_name: string;
  initials: string;
  color: string;
};
type StatusRow = {
  member_id: string;
  status: Status;
  arrival_order: number | null;
  updated_at: string;
};
type RequestRow = {
  id: string;
  from_member_id: string;
  to_member_id: string;
  created_at: string;
  resolved_at: string | null;
};
type ActivityRow = {
  id: string;
  message: string;
  created_at: string;
};

// En konstant avatar-syklus som nye brukere får tildelt basert på posisjon i
// teamet. Hindrer at alle blir "coral".
const COLOR_CYCLE: AvatarColor[] = ["coral", "navy", "lime", "purple", "peach", "mint", "rose", "sand"];

// Hent det ene teamet via RPC. SECURITY DEFINER-funksjonen omgår RLS slik at
// brukere som ikke er medlem ennå kan auto-joine. Defineres i SQL-skjemaet.
export async function getTheTeam(client: SupabaseClient) {
  const { data, error } = await client.rpc("the_team");
  if (error) throw error;
  const row = (data ?? [])[0] as { id: string; name: string } | undefined;
  return row ? { id: row.id, name: row.name, createdBy: "" } : null;
}

// Sikre at innlogget bruker er medlem av det ene teamet. Hvis ikke, legges de
// til automatisk med et nickname og en farge. Returnerer teamet.
export async function ensureTeamMembership(
  client: SupabaseClient,
  userId: string,
  displayName: string,
): Promise<{ teamId: string; memberId: string }> {
  const team = await getTheTeam(client);
  if (!team) throw new Error("Fant ingen team i databasen. Kjør SQL-skjemaet først.");

  await ensureFreshSession(client);

  // Forsøk å hente eksisterende medlemskap; vi prøver likevel å INSERT også,
  // fordi SELECT kan være skjult av RLS selv om insert-policyen slipper oss
  // igjennom senere.
  const { data: existing } = await client
    .from("team_members")
    .select("id")
    .eq("team_id", team.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return { teamId: team.id, memberId: existing.id };

  // Velg neste farge i syklusen basert på antall eksisterende medlemmer.
  const { count } = await client
    .from("team_members")
    .select("id", { count: "exact", head: true })
    .eq("team_id", team.id);
  const color = COLOR_CYCLE[(count ?? 0) % COLOR_CYCLE.length];

  const { data: created, error } = await client.from("team_members").insert({
    team_id: team.id,
    user_id: userId,
    display_name: displayName.trim() || "Kollega",
    initials: initialsFor(displayName || "Kollega"),
    color,
  }).select("id").single();
  if (!error) return { teamId: team.id, memberId: created.id };

  // RLS-brudd kan skyldes utløpt token — prøv én gang til med friskt token.
  if (/row-level security/i.test(error.message)) {
    await ensureFreshSession(client, true);
    const { data: retry, error: retryError } = await client.from("team_members").insert({
      team_id: team.id,
      user_id: userId,
      display_name: displayName.trim() || "Kollega",
      initials: initialsFor(displayName || "Kollega"),
      color,
    }).select("id").single();
    if (!retryError) return { teamId: team.id, memberId: retry.id };
    // 23505 = unique_violation. Da finnes raden allerede (f.eks. etter en
    // delvis vellykket kjøring) — hent den i stedet.
    if (retryError.code !== "23505") throw retryError;
  } else if (error.code !== "23505") {
    throw error;
  }

  // Fallback: spør etter den eksisterende raden vi nå vet må finnes.
  const { data: existingNow } = await client
    .from("team_members")
    .select("id")
    .eq("team_id", team.id)
    .eq("user_id", userId)
    .single();
  if (!existingNow) throw error;
  return { teamId: team.id, memberId: existingNow.id };
}

// Forsikre at access-tokenet i Supabase-klienten er friskt. getUser() returnerer
// det "offisielle" bruker-objektet og trigger automatisk refresh om nødvendig;
// refreshSession() gjør det samme uten å gjøre et API-kall.
async function ensureFreshSession(client: SupabaseClient, force = false) {
  if (force) {
    await client.auth.refreshSession();
    return;
  }
  // getUser() refresher også, men gir en bedre feil hvis noe er galt.
  await client.auth.getUser();
}

// -------- Members --------

export async function listMembers(client: SupabaseClient, teamId: string): Promise<Member[]> {
  const { data, error } = await client
    .from("team_members")
    .select("id, user_id, display_name, initials, color")
    .eq("team_id", teamId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Pick<MemberRow, "id" | "user_id" | "display_name" | "initials" | "color">[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.display_name,
    initials: row.initials,
    color: (AVATAR_COLORS.includes(row.color as AvatarColor) ? row.color : "coral") as AvatarColor,
  }));
}

export async function updateMemberProfile(
  client: SupabaseClient,
  memberId: string,
  displayName: string,
) {
  const { error } = await client
    .from("team_members")
    .update({ display_name: displayName.trim(), initials: initialsFor(displayName) })
    .eq("id", memberId);
  if (error) throw error;
}

// -------- Status --------

export async function fetchTodaysStatuses(
  client: SupabaseClient,
  teamId: string,
): Promise<Map<string, { status: Status; arrivalOrder?: number; updatedAt: string }>> {
  const { data, error } = await client
    .from("status_updates")
    .select("member_id, status, arrival_order, updated_at")
    .eq("team_id", teamId);
  if (error) throw error;
  const map = new Map<string, { status: Status; arrivalOrder?: number; updatedAt: string }>();
  for (const row of (data ?? []) as StatusRow[]) {
    const existing = map.get(row.member_id);
    if (!existing || row.updated_at > existing.updatedAt) {
      map.set(row.member_id, {
        status: row.status,
        arrivalOrder: row.arrival_order ?? undefined,
        updatedAt: row.updated_at,
      });
    }
  }
  return map;
}

export async function upsertStatus(
  client: SupabaseClient,
  teamId: string,
  memberId: string,
  status: Status,
  arrivalOrder?: number,
) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Oslo" });
  const { error } = await client.from("status_updates").upsert(
    {
      team_id: teamId,
      member_id: memberId,
      day: today,
      status,
      arrival_order: arrivalOrder ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "member_id,day" },
  );
  if (error) throw error;
}

// -------- Card requests --------

export async function createCardRequest(
  client: SupabaseClient,
  teamId: string,
  fromMemberId: string,
  toMemberId: string,
) {
  await client
    .from("card_requests")
    .update({ resolved_at: new Date().toISOString() })
    .eq("team_id", teamId)
    .is("resolved_at", null);
  const { data, error } = await client
    .from("card_requests")
    .insert({ team_id: teamId, from_member_id: fromMemberId, to_member_id: toMemberId })
    .select("id, from_member_id, to_member_id, created_at")
    .single();
  if (error) throw error;
  return data as Pick<RequestRow, "id" | "from_member_id" | "to_member_id" | "created_at">;
}

// Returnerer den nyeste ULØSTE forespørselen i teamet (per nåværende spec:
// den siste som ble sendt, som ikke er kvittert). Filtrerer bort resolved slik
// at brukeren ikke ser et gammelt varsel etter at forespørselen er håndtert.
export async function fetchLatestCardRequest(
  client: SupabaseClient,
  teamId: string,
): Promise<CardRequest | null> {
  const { data, error } = await client
    .from("card_requests")
    .select("id, from_member_id, to_member_id, created_at, resolved_at")
    .eq("team_id", teamId)
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    fromMemberId: data.from_member_id,
    toMemberId: data.to_member_id,
    createdAt: data.created_at,
  };
}

export async function resolveCardRequest(client: SupabaseClient, requestId: string) {
  const { error } = await client
    .from("card_requests")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", requestId);
  if (error) throw error;
}

// -------- Activity --------

export async function fetchRecentActivity(client: SupabaseClient, teamId: string): Promise<ActivityEvent[]> {
  const { data, error } = await client
    .from("activity_events")
    .select("id, message, created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(4);
  if (error) throw error;
  return ((data ?? []) as ActivityRow[]).map((row) => ({
    id: row.id,
    message: row.message,
    createdAt: row.created_at,
  }));
}

export async function appendActivity(
  client: SupabaseClient,
  teamId: string,
  memberId: string | null,
  message: string,
) {
  const { error } = await client.from("activity_events").insert({
    team_id: teamId,
    member_id: memberId,
    kind: "status",
    message,
  });
  if (error) throw error;
}

// -------- Helpers --------

export function statusFromString(value: string): Status {
  return STATUSES.includes(value as Status) ? (value as Status) : "Ikke startet";
}
