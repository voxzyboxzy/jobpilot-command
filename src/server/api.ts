import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { loadCandidate } from "../candidate/facts.js";
import { Store } from "../db/store.js";
import { approve, editPacketField } from "../agents/pipeline.js";
import type { Stage } from "../types.js";
import type { StoredJob } from "../db/store.js";

function send(res: import("node:http").ServerResponse, status: number, body: unknown, type = "application/json"): void {
  const payload = type === "application/json" ? JSON.stringify(body) : String(body);
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(payload);
}

async function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function startServer(config: AppConfig, port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const store = new Store(config.database);
  const webRoot = path.join(config.root, "dist-web");
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
      if (req.method === "GET" && url.pathname === "/api/health") {
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/overview") {
        const pipeline = store.listPipeline();
        const counts = { scout: 0, matcher: 0, tailor: 0, reviewer: 0 };
        for (const record of pipeline) {
          const seen = new Set(record.history.map((entry) => entry.to));
          if (seen.has("discovered") || seen.has("eligible") || seen.has("ineligible")) counts.scout += 1;
          if (seen.has("ranked")) counts.matcher += 1;
          if (seen.has("tailored")) counts.tailor += 1;
          if (["reviewed", "awaiting_approval", "approved", "blocked"].some((stage) => seen.has(stage as Stage))) counts.reviewer += 1;
        }
        const jobs = store.countJobs();
        const packets = store.listPackets();
        send(res, 200, {
          jobs,
          agentCounts: counts,
          approved: packets.filter((packet) => packet.approval).length,
          awaitingApproval: packets.filter((packet) => !packet.approval && packet.review.passed).length,
          blocked: packets.filter((packet) => !packet.review.passed).length,
          latestScout: store.latestRun("scout"),
          pipeline: pipeline.slice(0, 12),
          timezone: config.timezone,
          dailyAt: config.dailyAt,
          llm: config.llm.provider,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/jobs") {
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const ranked = store.topScores(Number.isFinite(limit) ? limit : 50);
        send(
          res,
          200,
          ranked.map((item, index) => ({
            rank: index + 1,
            job: publicJob(item.job),
            fit: item.fit,
            stage: store.getPipeline(item.job.id)?.stage ?? null,
            packet: store.getPacket(item.job.id)
              ? { contentHash: store.getPacket(item.job.id)?.contentHash, approved: Boolean(store.getPacket(item.job.id)?.approval) }
              : null,
          })),
        );
        return;
      }
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "jobs" && parts[2]) {
        const job = store.getJob(parts[2]);
        if (!job) return send(res, 404, { error: "Job not found" });
        send(res, 200, { job: publicJob(job), fit: store.getScore(job.id)?.fit ?? null, packet: store.getPacket(job.id), stage: store.getPipeline(job.id) });
        return;
      }
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "packets" && parts[2]) {
        const packet = store.getPacket(parts[2]);
        if (!packet) return send(res, 404, { error: "Packet not found" });
        send(res, 200, packet);
        return;
      }
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "packets" && parts[2] && parts[3] === "approve") {
        const body = (await readJson(req)) as { approver?: string };
        const packet = approve(store, parts[2], body.approver?.trim() || "human");
        send(res, 200, { contentHash: packet.contentHash, token: packet.approval?.token, approvedAt: packet.approval?.approvedAt });
        return;
      }
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "packets" && parts[2] && parts[3] === "fields") {
        const body = (await readJson(req)) as { key?: string; value?: string };
        if (!body.key || typeof body.value !== "string") return send(res, 400, { error: "key and value are required" });
        const candidate = loadCandidate(config.facts);
        const packet = editPacketField(store, parts[2], body.key, body.value, candidate);
        send(res, 200, packet);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/tracker") {
        send(res, 200, store.listTracker());
        return;
      }
      if (parts[0] === "api") return send(res, 404, { error: "Not found" });
      serveStatic(webRoot, url.pathname, res);
    } catch (error) {
      send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          store.close();
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function publicJob(job: StoredJob) {
  return {
    id: job.id,
    source: job.source,
    board: job.board,
    company: job.company,
    title: job.title,
    location: job.location,
    workplaceType: job.workplaceType,
    url: job.url,
    applyUrl: job.applyUrl,
    firstSeenAt: job.firstSeenAt,
    lastSeenAt: job.lastSeenAt,
    eligible: job.eligible,
    eligibility: job.eligibility,
  };
}

function serveStatic(webRoot: string, pathname: string, res: import("node:http").ServerResponse): void {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(webRoot, requested));
  if (!filePath.startsWith(webRoot)) {
    send(res, 403, "Forbidden", "text/plain");
    return;
  }
  const target = existsSync(filePath) && statSync(filePath).isFile() ? filePath : path.join(webRoot, "index.html");
  if (!existsSync(target)) {
    send(res, 503, { error: "Dashboard is not built. Run npm run build." });
    return;
  }
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
  };
  res.writeHead(200, { "content-type": types[path.extname(target)] ?? "application/octet-stream" });
  createReadStream(target).pipe(res);
}
