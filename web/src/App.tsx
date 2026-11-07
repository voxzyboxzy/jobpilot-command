import { NavLink, Route, Routes } from "react-router-dom";
import { JobsPage } from "./pages/Jobs";
import { PacketPage } from "./pages/Packet";
import { PipelinePage } from "./pages/Pipeline";
import { TrackerPage } from "./pages/Tracker";

export function App() {
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Human-approved pipeline</p>
            <h1>JobPilot Command</h1>
          </div>
        </div>
        <p className="tagline">Scout, match, tailor, and review. Nothing is submitted until you approve the exact packet.</p>
      </header>
      <div className="frame">
        <nav aria-label="Primary">
          <NavLink to="/" end>
            Pipeline
          </NavLink>
          <NavLink to="/jobs">Jobs</NavLink>
          <NavLink to="/tracker">Tracker</NavLink>
        </nav>
        <main id="main">
          <Routes>
            <Route path="/" element={<PipelinePage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/:jobId" element={<PacketPage />} />
            <Route path="/tracker" element={<TrackerPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
