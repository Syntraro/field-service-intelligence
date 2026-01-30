/**
 * Standardized display name logic for team members/technicians.
 * Use this everywhere you need to display a person's name to avoid
 * showing raw emails as primary identifiers.
 */

interface MemberLike {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
}

/**
 * Get the best display name for a team member/technician.
 * Priority: fullName > firstName+lastName > name > email > "Unnamed"
 */

export function getMemberSecondary(member: {
  role?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  // Prefer role, then email, then phone — tweak order if you want
  return (member.role ?? "").trim() || (member.email ?? "").trim() || (member.phone ?? "").trim();
}



export function getMemberDisplayName(member: {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}) {
  const full = (member.fullName ?? "").trim();
  if (full) return full;

  const first = (member.firstName ?? "").trim();
  const last = (member.lastName ?? "").trim();
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;

  return (member.email ?? "Unnamed").trim();
}

export function getMemberInitials(member: {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}) {
  const full = (member.fullName ?? "").trim();
  if (full) {
    const parts = full.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    const initials = `${first}${last}`.toUpperCase();
    return initials || (member.email?.[0] ?? "?").toUpperCase();
  }

  if (member.firstName || member.lastName) {
    const f = member.firstName?.[0] ?? "";
    const l = member.lastName?.[0] ?? "";
    const initials = `${f}${l}`.toUpperCase();
    if (initials) return initials;
  }

  return (member.email?.[0] ?? "?").toUpperCase();
}
