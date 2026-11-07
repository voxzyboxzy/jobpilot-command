import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getJson, type Overview } from "../api";

const AGENTS = [
  { key: "scout", name: "Scout", copy: "Pulls public Greenhouse, Ashby, and Lever boards and drops duplicates." },
  { key: "matcher", name: "Matcher", copy: "Scores eligible roles and cites the facts behind each point." },
  { key: "tailor", name: "Tailor", copy: "Writes bullets and answers that quote the candidate file." },
  { key: "reviewer", name: "Reviewer", copy: "Strips unsupported claims and waits for a person." },
] as const;

export function PipelinePage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    getJson<Overview>("/api/overview")
      .then((body) => {
        if (!cancel) setData(body);
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : "Could not load the pipeline.");
      });
    return () => {
      cancel = true;
    };
  }, []);
  if (error) return <p className="banner">{error}</p>;
  if (!data) return <p className="muted">Loading pipeline…</p>;
  return (
    <section>
      <div className="section-head">
        <h2>Agent pipeline</h2>
        <p>
          {data.timezone} daily at {data.dailyAt}. Model mode: {data.llm}. {data.jobs.eligible} eligible of {data.jobs.total} stored postings.
        </p>
      </div>
      <ol className="agents">
        {AGENTS.map((agent, index) => (
          <li key={agent.key}>
            <span className="step">0{index + 1}</span>
            <h3>{agent.name}</h3>
            <p>{agent.copy}</p>
            <strong>{data.agentCounts[agent.key]}</strong>
            <span className="muted">jobs reached</span>
          </li>
        ))}
      </ol>
      <div className="stats">
        <article>
          <span>Awaiting approval</span>
          <strong>{data.awaitingApproval}</strong>
        </article>
        <article>
          <span>Approved</span>
          <strong>{data.approved}</strong>
        </article>
        <article>
          <span>Blocked</span>
          <strong>{data.blocked}</strong>
        </article>
      </div>
      <p className="gate">Submission stays closed until a person approves the current packet hash. The form filler stops before the submit button by default.</p>
      <p>
        <Link className="text-link" to="/jobs">
          Review ranked jobs
        </Link>
      </p>
    </section>
  );
}
