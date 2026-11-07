import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Eligibility,
  FitResult,
  HistoryEntry,
  NormalizedJob,
  PipelineRecord,
  Stage,
  StoredPacket,
  TrackerEvent,
} from "../types.js";
import { newSecret } from "../util/hash.js";

interface JobRow {
  id: string;
  source: NormalizedJob["source"];
  board: string;
  external_id: string;
  company: string;
  title: string;
  location: string;
  workplace_type: NormalizedJob["workplaceType"];
  url: string;
  apply_url: string;
  content_text: string;
  departments_json: string;
  compensation: string | null;
  updated_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  eligible: number | null;
  eligibility_json: string | null;
  workplace_note: string | null;
  is_remote_flag: number | null;
  source_workplace: string | null;
}

export interface StoredJob extends NormalizedJob {
  firstSeenAt: string;
  lastSeenAt: string;
  eligible: boolean | null;
  eligibility: Eligibility | null;
}

function mapJob(row: JobRow): StoredJob {
  return {
    id: row.id,
    source: row.source,
    board: row.board,
    externalId: row.external_id,
    company: row.company,
    title: row.title,
    location: row.location,
    workplaceType: row.workplace_type,
    workplaceNote: row.workplace_note,
    url: row.url,
    applyUrl: row.apply_url,
    contentText: row.content_text,
    departments: JSON.parse(row.departments_json) as string[],
    compensation: row.compensation,
    updatedAt: row.updated_at,
    isRemoteFlag: row.is_remote_flag === null ? null : row.is_remote_flag === 1,
    sourceWorkplace: row.source_workplace,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    eligible: row.eligible === null ? null : row.eligible === 1,
    eligibility: row.eligibility_json ? (JSON.parse(row.eligibility_json) as Eligibility) : null,
  };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        board TEXT NOT NULL,
        external_id TEXT NOT NULL,
        company TEXT NOT NULL,
        title TEXT NOT NULL,
        location TEXT NOT NULL,
        workplace_type TEXT NOT NULL,
        workplace_note TEXT,
        url TEXT NOT NULL,
        apply_url TEXT NOT NULL,
        content_text TEXT NOT NULL,
        departments_json TEXT NOT NULL,
        compensation TEXT,
        updated_at TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        eligible INTEGER,
        eligibility_json TEXT,
        is_remote_flag INTEGER,
        source_workplace TEXT,
        UNIQUE(source, board, external_id)
      );
      CREATE TABLE IF NOT EXISTS scores (
        job_id TEXT PRIMARY KEY,
        score REAL NOT NULL,
        fit_json TEXT NOT NULL,
        facts_hash TEXT NOT NULL,
        scored_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS packets (
        job_id TEXT PRIMARY KEY,
        body_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        approval_token TEXT,
        approval_hash TEXT,
        approved_at TEXT,
        approver TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pipeline (
        job_id TEXT PRIMARY KEY,
        stage TEXT NOT NULL,
        history_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tracker (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT,
        status TEXT NOT NULL,
        note TEXT NOT NULL,
        artifact_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        stats_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  approvalSecret(): string {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'approval_secret'").get() as { value: string } | undefined;
    if (row) return row.value;
    const secret = newSecret();
    this.db.prepare("INSERT INTO meta(key, value) VALUES ('approval_secret', ?)").run(secret);
    return secret;
  }

  upsertJobs(jobs: NormalizedJob[], seenAt: string): { inserted: number; updated: number } {
    const select = this.db.prepare("SELECT id FROM jobs WHERE id = ?");
    const insert = this.db.prepare(`
      INSERT INTO jobs (
        id, source, board, external_id, company, title, location, workplace_type, workplace_note,
        url, apply_url, content_text, departments_json, compensation, updated_at,
        first_seen_at, last_seen_at, eligible, eligibility_json, is_remote_flag, source_workplace
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `);
    const update = this.db.prepare(`
      UPDATE jobs SET
        company = ?, title = ?, location = ?, workplace_type = ?, workplace_note = ?,
        url = ?, apply_url = ?, content_text = ?, departments_json = ?, compensation = ?,
        updated_at = ?, last_seen_at = ?, is_remote_flag = ?, source_workplace = ?
      WHERE id = ?
    `);
    let inserted = 0;
    let updated = 0;
    this.db.exec("BEGIN");
    try {
      for (const job of jobs) {
        const existing = select.get(job.id) as { id: string } | undefined;
        const remoteFlag = job.isRemoteFlag === null ? null : job.isRemoteFlag ? 1 : 0;
        if (!existing) {
          insert.run(
            job.id,
            job.source,
            job.board,
            job.externalId,
            job.company,
            job.title,
            job.location,
            job.workplaceType,
            job.workplaceNote,
            job.url,
            job.applyUrl,
            job.contentText,
            JSON.stringify(job.departments),
            job.compensation,
            job.updatedAt,
            seenAt,
            seenAt,
            remoteFlag,
            job.sourceWorkplace,
          );
          inserted += 1;
        } else {
          update.run(
            job.company,
            job.title,
            job.location,
            job.workplaceType,
            job.workplaceNote,
            job.url,
            job.applyUrl,
            job.contentText,
            JSON.stringify(job.departments),
            job.compensation,
            job.updatedAt,
            seenAt,
            remoteFlag,
            job.sourceWorkplace,
            job.id,
          );
          updated += 1;
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { inserted, updated };
  }

  saveEligibility(jobId: string, eligibility: Eligibility): void {
    this.db
      .prepare("UPDATE jobs SET eligible = ?, eligibility_json = ?, workplace_type = ? WHERE id = ?")
      .run(eligibility.eligible ? 1 : 0, JSON.stringify(eligibility), eligibility.workplace, jobId);
  }

  getJob(id: string): StoredJob | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? mapJob(row) : null;
  }

  listJobs(filter: { eligible?: boolean } = {}): StoredJob[] {
    const rows =
      filter.eligible === undefined
        ? (this.db.prepare("SELECT * FROM jobs ORDER BY first_seen_at DESC, title").all() as unknown as JobRow[])
        : (this.db
            .prepare("SELECT * FROM jobs WHERE eligible = ? ORDER BY first_seen_at DESC, title")
            .all(filter.eligible ? 1 : 0) as unknown as JobRow[]);
    return rows.map(mapJob);
  }

  countJobs(): { total: number; eligible: number } {
    const total = this.db.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number };
    const eligible = this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE eligible = 1").get() as { n: number };
    return { total: total.n, eligible: eligible.n };
  }

  saveScore(jobId: string, fit: FitResult, factsHash: string, scoredAt: string): void {
    this.db
      .prepare(
        `INSERT INTO scores(job_id, score, fit_json, facts_hash, scored_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET score = excluded.score, fit_json = excluded.fit_json, facts_hash = excluded.facts_hash, scored_at = excluded.scored_at`,
      )
      .run(jobId, fit.score, JSON.stringify(fit), factsHash, scoredAt);
  }

  getScore(jobId: string): { fit: FitResult; factsHash: string; scoredAt: string } | null {
    const row = this.db.prepare("SELECT * FROM scores WHERE job_id = ?").get(jobId) as
      | { fit_json: string; facts_hash: string; scored_at: string }
      | undefined;
    if (!row) return null;
    return { fit: JSON.parse(row.fit_json) as FitResult, factsHash: row.facts_hash, scoredAt: row.scored_at };
  }

  topScores(limit: number): { job: StoredJob; fit: FitResult }[] {
    const rows = this.db
      .prepare(
        `SELECT jobs.*, scores.fit_json FROM jobs
         JOIN scores ON scores.job_id = jobs.id
         WHERE jobs.eligible = 1
         ORDER BY scores.score DESC, jobs.title ASC
         LIMIT ?`,
      )
      .all(limit) as unknown as (JobRow & { fit_json: string })[];
    return rows.map((row) => ({ job: mapJob(row), fit: JSON.parse(row.fit_json) as FitResult }));
  }

  savePacket(packet: StoredPacket): void {
    this.db
      .prepare(
        `INSERT INTO packets(job_id, body_json, content_hash, approval_token, approval_hash, approved_at, approver, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET
           body_json = excluded.body_json,
           content_hash = excluded.content_hash,
           approval_token = excluded.approval_token,
           approval_hash = excluded.approval_hash,
           approved_at = excluded.approved_at,
           approver = excluded.approver,
           updated_at = excluded.updated_at`,
      )
      .run(
        packet.jobId,
        JSON.stringify(packet),
        packet.contentHash,
        packet.approval?.token ?? null,
        packet.approval?.contentHash ?? null,
        packet.approval?.approvedAt ?? null,
        packet.approval?.approver ?? null,
        packet.updatedAt,
      );
  }

  getPacket(jobId: string): StoredPacket | null {
    const row = this.db.prepare("SELECT body_json FROM packets WHERE job_id = ?").get(jobId) as { body_json: string } | undefined;
    return row ? (JSON.parse(row.body_json) as StoredPacket) : null;
  }

  listPackets(): StoredPacket[] {
    const rows = this.db.prepare("SELECT body_json FROM packets ORDER BY updated_at DESC").all() as { body_json: string }[];
    return rows.map((row) => JSON.parse(row.body_json) as StoredPacket);
  }

  savePipeline(record: PipelineRecord): void {
    this.db
      .prepare(
        `INSERT INTO pipeline(job_id, stage, history_json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET stage = excluded.stage, history_json = excluded.history_json, updated_at = excluded.updated_at`,
      )
      .run(record.jobId, record.stage, JSON.stringify(record.history), record.updatedAt);
  }

  getPipeline(jobId: string): PipelineRecord | null {
    const row = this.db.prepare("SELECT * FROM pipeline WHERE job_id = ?").get(jobId) as
      | { job_id: string; stage: Stage; history_json: string; updated_at: string }
      | undefined;
    if (!row) return null;
    return {
      jobId: row.job_id,
      stage: row.stage,
      history: JSON.parse(row.history_json) as HistoryEntry[],
      updatedAt: row.updated_at,
    };
  }

  listPipeline(): PipelineRecord[] {
    const rows = this.db.prepare("SELECT * FROM pipeline ORDER BY updated_at DESC").all() as {
      job_id: string;
      stage: Stage;
      history_json: string;
      updated_at: string;
    }[];
    return rows.map((row) => ({
      jobId: row.job_id,
      stage: row.stage,
      history: JSON.parse(row.history_json) as HistoryEntry[],
      updatedAt: row.updated_at,
    }));
  }

  track(jobId: string | null, status: string, note: string, artifact: unknown, createdAt: string): void {
    this.db
      .prepare("INSERT INTO tracker(job_id, status, note, artifact_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(jobId, status, note, artifact === undefined ? null : JSON.stringify(artifact), createdAt);
  }

  listTracker(): TrackerEvent[] {
    const rows = this.db.prepare("SELECT * FROM tracker ORDER BY id DESC").all() as {
      id: number;
      job_id: string | null;
      status: string;
      note: string;
      artifact_json: string | null;
      created_at: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      status: row.status,
      note: row.note,
      artifact: row.artifact_json ? JSON.parse(row.artifact_json) : null,
      createdAt: row.created_at,
    }));
  }

  startRun(id: string, kind: string, startedAt: string): void {
    this.db.prepare("INSERT INTO runs(id, kind, started_at, finished_at, stats_json) VALUES (?, ?, ?, NULL, '{}')").run(id, kind, startedAt);
  }

  finishRun(id: string, finishedAt: string, stats: unknown): void {
    this.db.prepare("UPDATE runs SET finished_at = ?, stats_json = ? WHERE id = ?").run(finishedAt, JSON.stringify(stats), id);
  }

  latestRun(kind: string): { id: string; startedAt: string; finishedAt: string | null; stats: unknown } | null {
    const row = this.db
      .prepare("SELECT * FROM runs WHERE kind = ? ORDER BY started_at DESC LIMIT 1")
      .get(kind) as { id: string; started_at: string; finished_at: string | null; stats_json: string } | undefined;
    if (!row) return null;
    return { id: row.id, startedAt: row.started_at, finishedAt: row.finished_at, stats: JSON.parse(row.stats_json) };
  }
}
