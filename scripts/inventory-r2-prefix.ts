/**
 * Read-only R2 inventory for one tenant prefix. No deletions.
 *
 * Usage: npx tsx scripts/inventory-r2-prefix.ts <companyId>
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../.env");
if (!process.env.R2_BUCKET && fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const companyId = process.argv[2];
if (!companyId) {
  console.error("Usage: tsx scripts/inventory-r2-prefix.ts <companyId>");
  process.exit(1);
}
const prefix = `tenants/${companyId}/`;
console.log(`Bucket: ${process.env.R2_BUCKET}`);
console.log(`Prefix: ${prefix}\n`);

const { getR2Provider, isR2Configured } = await import(
  "../server/services/storage/R2StorageProvider"
);
if (!isR2Configured()) {
  console.error("R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.");
  process.exit(2);
}
const r2 = getR2Provider();
let total = 0;
let totalBytes = 0;
const sample: string[] = [];
for await (const batch of r2.iterListObjectsByPrefix(r2.defaultBucket, prefix)) {
  for (const o of batch) {
    total += 1;
    totalBytes += o.sizeBytes;
    if (sample.length < 10) sample.push(o.key);
  }
}
console.log(`Objects under prefix: ${total}`);
console.log(`Total bytes:          ${totalBytes}`);
console.log(`Sample keys (first ${sample.length}):`);
for (const k of sample) console.log(`  ${k}`);
