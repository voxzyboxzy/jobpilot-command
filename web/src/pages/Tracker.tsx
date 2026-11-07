import { useEffect, useState } from "react";
import { getJson, type TrackerEvent } from "../api";

export function TrackerPage() {
  const [events, setEvents] = useState<TrackerEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    getJson<TrackerEvent[]>("/api/tracker")
      .then((body) => {
        if (!cancel) setEvents(body);
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : "Could not load the tracker.");
      });
    return () => {
      cancel = true;
    };
  }, []);
  if (error) return <p className="banner">{error}</p>;
  if (!events) return <p className="muted">Loading tracker…</p>;
  if (events.length === 0) return <p>No tracker events yet.</p>;
  return (
    <section>
      <div className="section-head">
        <h2>Tracker</h2>
        <p>Scout runs, packets, approvals, and form-fill handoffs.</p>
      </div>
      <table>
        <caption>Recent pipeline events</caption>
        <thead>
          <tr>
            <th>When</th>
            <th>Status</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{event.createdAt.replace("T", " ").slice(0, 19)}</td>
              <td>{event.status}</td>
              <td>{event.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
