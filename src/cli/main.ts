#!/usr/bin/env node
import { resolveConfig } from "../config.js";
import { loadCandidate } from "../candidate/facts.js";
import { Store } from "../db/store.js";
import { approve, buildPacket, ingestFixture, prepareTopPackets, scoutLive, scoreAll } from "../agents/pipeline.js";
import { fillApplication } from "../fill/filler.js";
import { assertCanSubmit } from "../packet/approval.js";
import { cronLine, nextDailyRun } from "../scheduler/schedule.js";
import { boardProbeUrl, fetchBoard } from "../sources/fetch.js";
import { appendBoard, loadWatchlist } from "../sources/watchlist.js";
import { SOURCES, type Source } from "../types.js";
import path from "node:path";
import { mkdirSync } from "node:fs";

interface Args {
  command: string;
  flags: Map<string, string | boolean>;
  positionals: string[];
}

function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] ?? "";
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) flags.set(key, true);
    else {
      flags.set(key, next);
      index += 1;
    }
  }
  return { command, flags, positionals };
}

function flag(args: Args, key: string): string | undefined {
  const value = args.flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function jsonMode(args: Args): boolean {
  return args.flags.has("json");
}

function emit(args: Args, data: unknown, human: string): void {
  if (jsonMode(args)) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else process.stdout.write(`${human}\n`);
}

function help(): string {
  return `JobPilot Command

  jobpilot scout [--json]
  jobpilot scout --fixture fixtures/recorded/jobs.json [--json]
  jobpilot rank --top 10 --json
  jobpilot packet <job-id> [--json]
  jobpilot approve <job-id> [--by "Your Name"] [--json]
  jobpilot fill <job-id> --stop-before-submit [--json]
  jobpilot fill <job-id> --submit --token <approval-token>
  jobpilot tracker [--json]
  jobpilot daily [--json]
  jobpilot boards list [--json]
  jobpilot boards add --source greenhouse --token acme --company "Acme"
  jobpilot boards verify [--json]
  jobpilot schedule --print
  jobpilot eval [--json]
  jobpilot demo [--serve] [--port 8787]
  jobpilot serve [--port 8787]

Submission is impossible without an approval token for the current packet hash.
The filler stops before submit unless you pass --submit and a valid token.
`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help" || args.flags.has("help")) {
    process.stdout.write(help());
    return;
  }
  const config = resolveConfig();
  if (args.command === "eval") {
    const { runEval } = await import("../eval/run.js");
    const result = await runEval();
    emit(args, result, formatEval(result));
    return;
  }
  if (args.command === "schedule") {
    const command = `cd ${config.root} && npm run jobpilot -- daily --json >> data/daily.log 2>&1`;
    const text = cronLine(config.dailyAt, config.timezone, command);
    const next = nextDailyRun(new Date(), config.timezone, config.dailyAt).toISOString();
    emit(args, { cron: text, next, timezone: config.timezone }, `${text}\n# next run ${next}`);
    return;
  }
  if (args.command === "serve" || (args.command === "demo" && args.flags.has("serve"))) {
    if (args.command === "demo") await runDemo(config, args);
    const { startServer } = await import("../server/api.js");
    const port = Number(flag(args, "port") ?? 8787);
    const server = await startServer(config, port);
    process.stderr.write(`JobPilot Command listening on ${server.url}\n`);
    return;
  }
  if (args.command === "demo") {
    const summary = await runDemo(config, args);
    emit(args, summary, `Demo ready. ${summary.eligible} eligible of ${summary.fetched} recorded postings. Top score ${summary.topScore}. Packets ${summary.packets}.`);
    return;
  }

  const store = new Store(config.database);
  try {
    if (args.command === "scout") {
      const families = config.roleFamilies;
      const fixture = flag(args, "fixture");
      const stats = fixture
        ? ingestFixture(store, path.resolve(fixture), config.watchlist, families)
        : await scoutLive(store, loadWatchlist(config.watchlist), families);
      emit(args, stats, `Scout stored ${String(stats.fetched)} postings. Eligible ${String(stats.eligible)}.`);
      return;
    }
    if (args.command === "rank") {
      const candidate = loadCandidate(config.facts);
      scoreAll(store, candidate);
      const top = Number(flag(args, "top") ?? config.topDefault);
      const rows = store.topScores(top).map((item, index) => ({
        rank: index + 1,
        jobId: item.job.id,
        title: item.job.title,
        company: item.job.company,
        location: item.job.location,
        workplaceType: item.job.workplaceType,
        url: item.job.url,
        score: item.fit.score,
        roleFamilies: item.fit.roleFamilies,
        summary: item.fit.summary,
        evidence: item.fit.evidence,
        firstSeenAt: item.job.firstSeenAt,
      }));
      emit(args, { top: rows }, rows.map((row) => `${row.rank}. ${row.score} ${row.company} — ${row.title}`).join("\n") || "No eligible jobs.");
      return;
    }
    if (args.command === "packet") {
      const jobId = args.positionals[0];
      if (!jobId) throw new Error("Usage: jobpilot packet <job-id>");
      const job = store.getJob(jobId);
      if (!job) throw new Error(`Unknown job ${jobId}`);
      const candidate = loadCandidate(config.facts);
      if (!store.getScore(jobId)) scoreAll(store, candidate);
      const packet = await buildPacket(store, job, candidate, config.resume);
      emit(args, packet, `Packet ${packet.jobId} hash ${packet.contentHash} review ${packet.review.passed ? "pass" : "fail"}`);
      return;
    }
    if (args.command === "approve") {
      const jobId = args.positionals[0];
      if (!jobId) throw new Error("Usage: jobpilot approve <job-id>");
      const packet = approve(store, jobId, flag(args, "by") ?? "human");
      emit(args, { jobId, contentHash: packet.contentHash, token: packet.approval?.token }, `Approved ${jobId}\n${packet.approval?.token}`);
      return;
    }
    if (args.command === "fill") {
      const jobId = args.positionals[0];
      if (!jobId) throw new Error("Usage: jobpilot fill <job-id> --stop-before-submit");
      const packet = store.getPacket(jobId);
      const job = store.getJob(jobId);
      if (!packet || !job) throw new Error(`Build a packet before filling ${jobId}`);
      const submit = args.flags.has("submit");
      const stop = args.flags.has("stop-before-submit") || !submit;
      if (submit && !stop) assertCanSubmit(store.approvalSecret(), packet, flag(args, "token") ?? packet.approval?.token);
      const url = flag(args, "url") ?? packet.applyUrl;
      if (!url) throw new Error("No apply URL. Pass --url.");
      mkdirSync(path.join(config.root, "data", "artifacts"), { recursive: true });
      const screenshotPath = path.join(config.root, "data", "artifacts", `${jobId.replace(/[^a-z0-9.-]+/gi, "_")}.png`);
      const report = await fillApplication({
        jobId,
        url,
        packet,
        resumePath: config.resume,
        stopBeforeSubmit: stop,
        submit: submit && !stop,
        approvalToken: flag(args, "token") ?? packet.approval?.token,
        secret: store.approvalSecret(),
        screenshotPath,
      });
      store.track(jobId, report.submitted ? "submitted" : report.handoff ? "handoff" : "stopped", report.handoffReasons.join(" ") || "Filled and stopped before submit.", report, new Date().toISOString());
      emit(args, report, `Filled ${report.fields.length} fields. ${report.handoff ? `Handoff: ${report.handoffReasons.join(" ")}` : report.submitted ? "Submitted." : "Stopped before submit."}`);
      if (report.handoff) process.exitCode = 2;
      return;
    }
    if (args.command === "tracker") {
      const events = store.listTracker();
      emit(args, { events }, events.slice(0, 20).map((event) => `${event.createdAt} ${event.status} ${event.note}`).join("\n") || "Tracker is empty.");
      return;
    }
    if (args.command === "daily") {
      const families = config.roleFamilies;
      const fixture = flag(args, "fixture");
      const scoutStats = fixture
        ? ingestFixture(store, path.resolve(fixture), config.watchlist, families)
        : await scoutLive(store, loadWatchlist(config.watchlist), families);
      const candidate = loadCandidate(config.facts);
      const scored = scoreAll(store, candidate);
      const packets = await prepareTopPackets(store, candidate, config.resume, Number(flag(args, "top") ?? config.topDefault));
      const digest = {
        scout: scoutStats,
        scored: scored.scored,
        packets: packets.map((packet) => ({ jobId: packet.jobId, title: packet.title, company: packet.company, hash: packet.contentHash, approved: Boolean(packet.approval) })),
      };
      emit(args, digest, `Daily run scored ${scored.scored} eligible jobs and refreshed ${packets.length} packets. Nothing was submitted.`);
      return;
    }
    if (args.command === "boards") {
      const sub = args.positionals[0] ?? "list";
      if (sub === "list") {
        const boards = loadWatchlist(config.watchlist);
        emit(args, { boards }, boards.map((board) => `${board.source}\t${board.token}\t${board.company}`).join("\n"));
        return;
      }
      if (sub === "add") {
        const source = flag(args, "source");
        const token = flag(args, "token");
        const company = flag(args, "company");
        if (!source || !token || !company || !SOURCES.includes(source as Source)) {
          throw new Error("Usage: jobpilot boards add --source greenhouse|ashby|lever --token TOKEN --company NAME");
        }
        appendBoard(config.watchlist, { source: source as Source, token, company });
        emit(args, { added: { source, token, company } }, `Added ${source}:${token}`);
        return;
      }
      if (sub === "verify") {
        const boards = loadWatchlist(config.watchlist);
        const results = [];
        for (const board of boards) {
          try {
            const jobs = await fetchBoard(board, 20000);
            results.push({ ...board, ok: true, jobs: jobs.length, url: boardProbeUrl(board) });
            process.stderr.write(`ok ${board.source}:${board.token} ${jobs.length}\n`);
          } catch (error) {
            results.push({ ...board, ok: false, error: error instanceof Error ? error.message : String(error) });
            process.stderr.write(`fail ${board.source}:${board.token}\n`);
          }
        }
        const ok = results.filter((item) => item.ok).length;
        emit(args, { ok, total: results.length, results }, `${ok}/${results.length} boards responded.`);
        if (ok !== results.length) process.exitCode = 1;
        return;
      }
    }
    throw new Error(`Unknown command ${args.command}\n\n${help()}`);
  } finally {
    store.close();
  }
}

async function runDemo(config: ReturnType<typeof resolveConfig>, args: Args): Promise<{
  database: string;
  fetched: number;
  eligible: number;
  topScore: number | null;
  topJobId: string | null;
  packets: number;
}> {
  const database = flag(args, "database") ?? path.join(config.root, "data", "demo", "jobpilot.db");
  const store = new Store(database);
  try {
    const fixture = flag(args, "fixture") ?? path.join(config.root, "fixtures", "recorded", "jobs.json");
    const scoutStats = ingestFixture(store, fixture, config.watchlist, config.roleFamilies);
    const candidate = loadCandidate(config.facts);
    scoreAll(store, candidate);
    const packets = await prepareTopPackets(store, candidate, config.resume, 8);
    const top = store.topScores(1)[0];
    if (args.flags.has("serve")) config.database = database;
    return {
      database,
      fetched: Number(scoutStats.fetched ?? 0),
      eligible: Number(scoutStats.eligible ?? 0),
      topScore: top?.fit.score ?? null,
      topJobId: top?.job.id ?? null,
      packets: packets.length,
    };
  } finally {
    store.close();
  }
}

function formatEval(result: { precisionAt10: number; k: number; relevantInTop: number; unsupportedClaimRate: number; residualUnsupportedRate: number; formFieldAccuracy: number; approvalBypasses: number; injectionFailures: number }): string {
  return [
    `precision@${result.k} ${result.relevantInTop}/${result.k} = ${result.precisionAt10.toFixed(2)}`,
    `unsupported-claim rate ${result.unsupportedClaimRate}`,
    `residual unsupported ${result.residualUnsupportedRate}`,
    `form-field accuracy ${result.formFieldAccuracy}`,
    `approval bypasses ${result.approvalBypasses}`,
    `injection failures ${result.injectionFailures}`,
  ].join("\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  const code = message.startsWith("Submission blocked") ? 3 : 1;
  process.exitCode = code;
});
