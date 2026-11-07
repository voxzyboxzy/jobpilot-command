import { createServer, type IncomingMessage } from "node:http";

export interface MockSubmission {
  at: string;
  body: string;
  contentType: string;
}

function page(title: string, formInner: string, action = "/submit"): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
  <main>
    <h1>${title}</h1>
    <form method="post" action="${action}" enctype="multipart/form-data">
      ${formInner}
      <button type="submit">Submit application</button>
    </form>
  </main>
</body>
</html>`;
}

const knownFields = `
  <label>First name <input name="first_name" required></label>
  <label>Last name <input name="last_name" required></label>
  <label>Email <input name="email" type="email" required></label>
  <label>Phone <input name="phone" required></label>
  <label>Location <input name="location" required></label>
  <label>Work authorization
    <select name="work_authorization" required>
      <option value="">Select</option>
      <option>Yes</option>
      <option>No</option>
    </select>
  </label>
  <label>Will you require sponsorship?
    <select name="sponsorship" required>
      <option value="">Select</option>
      <option>Yes</option>
      <option>No</option>
    </select>
  </label>
  <label>Resume <input type="file" name="resume" required></label>
  <label>Cover letter <textarea name="cover_letter" required></textarea></label>
  <label>LinkedIn URL <input name="linkedin"></label>
  <label>Gender
    <select name="gender">
      <option value="">Decline</option>
      <option>Female</option>
      <option>Male</option>
    </select>
  </label>
`;

function routeHtml(url: URL): string | null {
  const path = url.pathname;
  if (/^\/greenhouse\/[^/]+\/jobs\/[^/]+\/captcha$/.test(path)) {
    return page(
      "Greenhouse application",
      `${knownFields}<div class="g-recaptcha" data-sitekey="mock"></div><iframe src="https://www.google.com/recaptcha/api2/anchor" title="captcha"></iframe>`,
    );
  }
  if (/^\/greenhouse\/[^/]+\/jobs\/[^/]+\/unknown$/.test(path)) {
    return page(
      "Greenhouse application",
      `${knownFields}<label>Tell us a debugging story from your childhood <input name="childhood_story" required></label>`,
    );
  }
  if (/^\/greenhouse\/[^/]+\/jobs\/[^/]+$/.test(path)) return page("Greenhouse application", knownFields);
  if (/^\/ashby\/[^/]+\/[^/]+\/application$/.test(path)) return page("Ashby application", knownFields);
  if (/^\/lever\/[^/]+\/[^/]+\/apply$/.test(path)) return page("Lever application", knownFields);
  if (path === "/health") return "ok";
  return null;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export async function startMockAts(port = 0): Promise<{
  url: string;
  submissions: MockSubmission[];
  close: () => Promise<void>;
}> {
  const submissions: MockSubmission[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/submit") {
      const body = await readBody(req);
      submissions.push({ at: new Date().toISOString(), body, contentType: req.headers["content-type"] ?? "" });
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body><h1>Application received</h1></body></html>");
      return;
    }
    if (req.method === "GET" && url.pathname === "/submissions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(submissions));
      return;
    }
    const html = routeHtml(url);
    if (!html) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    if (html === "ok") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock ATS failed to bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    submissions,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function mockGreenhouseUrl(base: string, id = "job-1"): string {
  return `${base}/greenhouse/acme/jobs/${id}`;
}
