export function encodeCursor(createdAtISO: string, id: string) {
  return Buffer.from(`${createdAtISO}|${id}`, "utf8").toString("base64");
}

export function decodeCursor(cursor: string) {
  const raw = Buffer.from(cursor, "base64").toString("utf8");
  const [createdAtISO, id] = raw.split("|");
  if (!createdAtISO || !id) throw new Error("Invalid cursor");
  return { createdAtISO, id };
}
