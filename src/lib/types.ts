export type Status = "Ikke startet" | "På vei" | "I nærheten" | "På plass" | "Gått videre";

export type AvatarColor = "coral" | "navy" | "lime" | "purple" | "peach" | "mint" | "rose" | "sand";

export const STATUSES: Status[] = ["Ikke startet", "På vei", "I nærheten", "På plass", "Gått videre"];

export const AVATAR_COLORS: AvatarColor[] = ["coral", "navy", "lime", "purple", "peach", "mint", "rose", "sand"];

export const STATUS_META: Record<Status, { icon: string; label: string; className: string }> = {
  "Ikke startet": { icon: "○", label: "Ikke startet", className: "status-idle" },
  "På vei": { icon: "↗", label: "På vei", className: "status-way" },
  "I nærheten": { icon: "◉", label: "I nærheten", className: "status-near" },
  "På plass": { icon: "✓", label: "På plass", className: "status-there" },
  "Gått videre": { icon: "→", label: "Gått videre", className: "status-gone" },
};

export type Member = {
  id: string;
  name: string;
  initials: string;
  color: AvatarColor;
  userId: string;
};

export type MemberWithStatus = Member & {
  status: Status;
  updated: string;
  arrivalOrder?: number;
};

export type CardRequest = {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  createdAt: string;
};

export type ActivityEvent = {
  id: string;
  message: string;
  createdAt: string;
};

export function initialsFor(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "DU";
}

export function firstNameOf(name: string) {
  return name.split(" ")[0] || name;
}
