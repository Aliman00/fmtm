// Mapper tekniske feil fra Supabase/Postgres til korte, brukervennlige norsk
// meldinger. Logger full error til konsollen for debugging.

export function friendlyError(caught: unknown, fallback = "Noe gikk galt. Prøv igjen."): string {
  const message = errorMessageOf(caught);
  // Database-spesifikke mønstre
  if (/row-level security/i.test(message)) {
    return "Du har ikke tilgang til denne handlingen.";
  }
  if (/duplicate key|unique constraint/i.test(message)) {
    return "Denne handlingen er allerede utført.";
  }
  if (/foreign key/i.test(message)) {
    return "Koblingen finnes ikke lenger. Last inn siden på nytt.";
  }
  if (/invalid.*token|JWT|expired/i.test(message)) {
    return "Økten har utløpt. Logg inn på nytt.";
  }
  if (/network|fetch|timeout/i.test(message)) {
    return "Nettverksfeil. Sjekk tilkoblingen din.";
  }
  // Auth-spesifikke mønstre
  if (/invalid login|invalid credentials/i.test(message)) {
    return "Feil e-post eller kode.";
  }
  if (/rate limit|too many/i.test(message)) {
    return "For mange forsøk. Vent litt og prøv igjen.";
  }
  if (/email not confirmed/i.test(message)) {
    return "Bekreft e-posten din først.";
  }
  return fallback;
}

function errorMessageOf(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  if (typeof caught === "object" && caught !== null && "message" in caught) {
    return String((caught as { message: unknown }).message);
  }
  return String(caught);
}
