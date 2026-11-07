import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getJson, type Packet } from "../api";

interface JobDetail {
  job: { title: string; company: string; url: string };
  fit: { score: number; summary: string } | null;
  packet: Packet | null;
  stage: { stage: string } | null;
}

export function PacketPage() {
  const { jobId = "" } = useParams();
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function load() {
    setError(null);
    getJson<JobDetail>(`/api/jobs/${encodeURIComponent(jobId)}`)
      .then((body) => {
        setDetail(body);
        setDraft(body.packet?.coverLetter ?? "");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the packet."));
  }

  useEffect(() => {
    let cancel = false;
    getJson<JobDetail>(`/api/jobs/${encodeURIComponent(jobId)}`)
      .then((body) => {
        if (cancel) return;
        setDetail(body);
        setDraft(body.packet?.coverLetter ?? "");
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : "Could not load the packet.");
      });
    return () => {
      cancel = true;
    };
  }, [jobId]);

  async function approve() {
    setMessage(null);
    const response = await fetch(`/api/packets/${encodeURIComponent(jobId)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approver: "dashboard" }),
    });
    const body = (await response.json()) as { error?: string; token?: string };
    if (!response.ok) {
      setMessage(body.error ?? "Approval failed");
      return;
    }
    setMessage(`Approved. Token ${body.token ?? ""}`);
    load();
  }

  async function saveEdit() {
    setMessage(null);
    const response = await fetch(`/api/packets/${encodeURIComponent(jobId)}/fields`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "cover_letter", value: draft }),
    });
    const body = (await response.json()) as { error?: string; approval?: unknown; review?: { passed: boolean } };
    if (!response.ok) {
      setMessage(body.error ?? "Edit failed");
      return;
    }
    setMessage(body.review?.passed ? "Saved. Approval was cleared." : "Saved. Reviewer flagged unsupported text, so approval stays blocked.");
    load();
  }

  if (error) return <p className="banner">{error}</p>;
  if (!detail) return <p className="muted">Loading packet…</p>;
  const packet = detail.packet;
  return (
    <section>
      <p>
        <Link className="text-link" to="/jobs">
          Back to jobs
        </Link>
      </p>
      <div className="section-head">
        <h2>{detail.job.title}</h2>
        <p>
          {detail.job.company}
          {detail.fit ? ` · fit ${detail.fit.score}` : ""} · stage {detail.stage?.stage ?? "unknown"}
        </p>
      </div>
      {!packet ? <p>No packet yet. Run <code>jobpilot packet {jobId}</code>.</p> : null}
      {packet ? (
        <div className="packet">
          <div>
            <h3>Fields</h3>
            <table>
              <caption>Application fields and where each value came from</caption>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {packet.fields.map((field) => (
                  <tr key={field.key}>
                    <th scope="row">{field.label}</th>
                    <td>{field.value === null ? "—" : field.value.length > 90 ? `${field.value.slice(0, 90)}…` : field.value}</td>
                    <td>
                      {field.source}
                      {field.factIds.length > 0 ? <code> {field.factIds.join(" ")}</code> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Common answers</h3>
            <ul className="answers">
              {packet.answers.map((answer) => (
                <li key={answer.question}>
                  <strong>{answer.question}</strong>
                  <span>{answer.value ?? answer.reason ?? answer.disposition}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Cover letter</h3>
            <pre>{packet.coverLetter}</pre>
            <label>
              Edit cover letter
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={8} />
            </label>
            <div className="actions">
              <button type="button" onClick={() => void saveEdit()}>
                Save edit
              </button>
              <button type="button" className="primary" onClick={() => void approve()} disabled={!packet.review.passed}>
                Approve packet
              </button>
            </div>
            <p className="meta">Hash {packet.contentHash.slice(0, 16)}</p>
            <p className="meta">{packet.approval ? `Approved by ${packet.approval.approver} at ${packet.approval.approvedAt}` : "Not approved. Submit stays disabled."}</p>
            {packet.review.injections.length > 0 ? <p className="banner">Posting text included instruction-like lines. They were ignored.</p> : null}
            {packet.review.removed.length > 0 ? (
              <ul className="evidence">
                {packet.review.removed.map((item) => (
                  <li key={item.text} className="gap">
                    <strong>removed</strong> {item.reason}
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Reviewer found no unsupported claims.</p>
            )}
            {message ? <p role="status">{message}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
