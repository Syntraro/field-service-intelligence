export const shiftKeys = {
  all: ["shift-management"] as const,
  availability: (start: string, end: string) =>
    [...shiftKeys.all, "availability", start, end] as const,
  shifts: () => [...shiftKeys.all, "shifts"] as const,
  shift: (id: string) => [...shiftKeys.shifts(), id] as const,
};
