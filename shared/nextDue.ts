/**
 * Canonical next-due date computation for PM scheduling.
 *
 * Pure function shared between server and client.
 * Given a set of 0-indexed selected months, computes the next due date
 * using the 15th-of-month convention.
 *
 * Rules:
 * 1. If selectedMonths is empty → null (no PM)
 * 2. If current month is in selectedMonths AND current day < 15 → 15th of current month
 * 3. Otherwise, find the first selected month after the current month → 15th of that month
 * 4. If no selected month remains this year → wrap to the first selected month of next year
 */
export function computeNextDueDate(selectedMonths: number[]): Date | null {
  if (!selectedMonths || selectedMonths.length === 0) {
    return null;
  }

  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const currentDay = today.getDate();
  const sorted = [...selectedMonths].sort((a, b) => a - b);

  if (sorted.includes(currentMonth) && currentDay < 15) {
    return new Date(currentYear, currentMonth, 15);
  }

  let next = sorted.find((m) => m > currentMonth);

  if (next === undefined) {
    next = sorted[0];
    return new Date(currentYear + 1, next, 15);
  }

  return new Date(currentYear, next, 15);
}
