import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import type { PacketBody, StoredPacket } from "../types.js";
import { contentHash, signApproval, verifyApproval } from "../util/hash.js";

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

export async function sha256File(filePath: string): Promise<string | null> {
  try {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    for await (const chunk of stream) hash.update(chunk as Buffer);
    return hash.digest("hex");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export function packetHash(body: Pick<PacketBody, "fields" | "answers" | "bullets" | "coverLetter" | "attachments">): string {
  return contentHash({
    fields: body.fields.map((field) => ({ key: field.key, value: field.value, factIds: field.factIds })),
    answers: body.answers.map((answer) => ({ question: answer.question, value: answer.value, factIds: answer.factIds })),
    bullets: body.bullets,
    coverLetter: body.coverLetter,
    attachments: body.attachments.map((file) => ({ name: file.name, sha256: file.sha256 })),
  });
}

export function grantApproval(secret: string, packet: StoredPacket, approver: string, at: string): StoredPacket {
  if (!packet.review.passed) {
    throw new ApprovalError("Reviewer still has unsupported claims. Fix them before approval.");
  }
  const token = signApproval(secret, packet.jobId, packet.contentHash);
  return {
    ...packet,
    approval: { token, contentHash: packet.contentHash, approvedAt: at, approver },
    updatedAt: at,
  };
}

export function assertCanSubmit(secret: string, packet: StoredPacket, token: string | undefined): void {
  if (!token) throw new ApprovalError("Submission blocked: missing approval token.");
  if (!packet.approval) throw new ApprovalError("Submission blocked: packet is not approved.");
  if (packet.approval.contentHash !== packet.contentHash) {
    throw new ApprovalError("Submission blocked: packet changed after approval.");
  }
  if (packet.approval.token !== token) throw new ApprovalError("Submission blocked: token does not match this packet.");
  if (!verifyApproval(secret, packet.jobId, packet.contentHash, token)) {
    throw new ApprovalError("Submission blocked: approval token failed verification.");
  }
  if (!packet.review.passed) throw new ApprovalError("Submission blocked: reviewer did not pass.");
}

export function invalidateIfEdited(packet: StoredPacket, at: string): StoredPacket {
  const hash = packetHash(packet);
  if (hash === packet.contentHash) return packet;
  return { ...packet, contentHash: hash, approval: null, updatedAt: at };
}
