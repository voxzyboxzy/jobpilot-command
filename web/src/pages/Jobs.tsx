import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getJson, type JobCard } from "../api";

export function JobsPage() {
  const [jobs, setJobs] = useState<JobCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    getJson<JobCard[]>("/api/jobs?limit=20")
      .then((body) => {
        if (!cancel) setJobs(body);
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : "Could not load jobs.");
      });
    return () => {
      cancel = true;
    };
  }, []);
  if (error) return <p className="banner">{error}</p>;
  if (!jobs) return <p className="muted">Loading jobs…</p>;
  if (jobs.length === 0) return <p>No eligible jobs yet. Run <code>jobpilot scout</code> or the demo.</p>;
  return (
    <section>
      <div className="section-head">
        <h2>Ranked jobs</h2>
        <p>Fit scores cite candidate facts. Gaps stay visible.</p>
      </div>
      <ul className="job-list">
        {jobs.map((item) => (
          <li key={item.job.id}>
            <div className="job-row">
              <div className="score" style={{ ["--score" as string]: `${item.fit.score}%` }}>
                <span>{item.fit.score}</span>
              </div>
              <div>
                <h3>
                  <Link to={`/jobs/${encodeURIComponent(item.job.id)}`}>{item.job.title}</Link>
                </h3>
                <p className="meta">
                  {item.job.company} · {item.job.location || "Location unset"} · {item.job.workplaceType} · {item.job.source}
                </p>
                <p>{item.fit.summary}</p>
                <p className="meta">First seen {item.job.firstSeenAt.slice(0, 10)}</p>
                <button type="button" onClick={() => setOpen(open === item.job.id ? null : item.job.id)} aria-expanded={open === item.job.id}>
                  {open === item.job.id ? "Hide evidence" : "Show evidence"}
                </button>
              </div>
            </div>
            {open === item.job.id ? (
              <ul className="evidence">
                {item.fit.evidence.map((evidence) => (
                  <li key={`${item.job.id}-${evidence.requirement}`} className={evidence.relation}>
                    <strong>{evidence.relation}</strong> {evidence.requirement}
                    <span>{evidence.detail}</span>
                    {evidence.factIds.length > 0 ? <code>{evidence.factIds.join(" ")}</code> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
