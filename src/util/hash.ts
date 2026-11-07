import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export function contentHash(value: unknown): string {
  return sha256(canonical(value));
}

export function newSecret(): string {
  return randomBytes(32).toString("hex");
}

export function signApproval(secret: string, packetId: string, hash: string): string {
  const mac = createHmac("sha256", secret).update(`${packetId}.${hash}`).digest();
  return `jp1.${mac.toString("base64url")}`;
}

export function verifyApproval(secret: string, packetId: string, hash: string, token: string): boolean {
  const expected = signApproval(secret, packetId, hash);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
