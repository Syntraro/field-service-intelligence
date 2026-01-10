import { CALENDAR_RULES } from "../../shared/calendarRules";

interface JobResizePayload {
  id: string;
  scheduledStart: string;
  scheduledEnd: string;
  [key: string]: unknown;
}

export function resizeJobTime(job: JobResizePayload, newEndTime: string) {
  if (!CALENDAR_RULES.allowResize) {
    throw new Error("Resize not allowed");
  }

  return {
    ...job,
    endTime: newEndTime,
    updatedFrom: "calendar",
  };
}
