/**
 * Shared regional constants used across RegionalSettingsPage, TimezoneSetupDialog,
 * and any future component that needs timezone options.
 *
 * Superset of both previous local arrays — eliminates duplication.
 */

export const TIMEZONE_OPTIONS = [
  { value: "America/Toronto", label: "Eastern - Toronto" },
  { value: "America/New_York", label: "Eastern - New York" },
  { value: "America/Chicago", label: "Central - Chicago" },
  { value: "America/Denver", label: "Mountain - Denver" },
  { value: "America/Los_Angeles", label: "Pacific - Los Angeles" },
  { value: "America/Vancouver", label: "Pacific - Vancouver" },
  { value: "America/Edmonton", label: "Mountain - Edmonton" },
  { value: "America/Winnipeg", label: "Central - Winnipeg" },
  { value: "America/Halifax", label: "Atlantic - Halifax" },
  { value: "America/St_Johns", label: "Newfoundland - St. John's" },
  { value: "America/Regina", label: "Central No DST - Regina" },
  { value: "America/Phoenix", label: "Mountain No DST - Phoenix" },
  { value: "Pacific/Honolulu", label: "Hawaii - Honolulu" },
  { value: "America/Anchorage", label: "Alaska - Anchorage" },
  { value: "Europe/London", label: "GMT - London" },
  { value: "Europe/Paris", label: "CET - Paris" },
  { value: "Australia/Sydney", label: "AEST - Sydney" },
  { value: "UTC", label: "UTC" },
] as const;
