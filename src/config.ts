import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ROLE_FAMILIES, type RoleFamily } from "./types.js";

const ConfigSchema = z.object({
  database: z.string().default("data/jobpilot.db"),
  facts: z.string().default("examples/candidate.example.yaml"),
  resume: z.string().default("examples/Alex-Rivera-Resume.pdf"),
  watchlist: z.string().default("config/watchlist.yaml"),
  timezone: z.string().default("America/New_York"),
  dailyAt: z.string().regex(/^\d{2}:\d{2}$/).default("07:30"),
  topDefault: z.number().int().positive().default(10),
  roleFamilies: z.array(z.enum(ROLE_FAMILIES)).min(1).default([...ROLE_FAMILIES]),
  llm: z
    .object({
      provider: z.enum(["heuristic", "openai", "ollama"]).default("heuristic"),
      baseUrl: z.string().optional(),
      model: z.string().optional(),
    })
    .default({ provider: "heuristic" }),
});

export type AppConfig = z.infer<typeof ConfigSchema> & {
  root: string;
  roleFamilies: RoleFamily[];
};

export function resolveConfig(root = process.cwd()): AppConfig {
  const configPath = process.env.JOBPILOT_CONFIG
    ? path.resolve(process.env.JOBPILOT_CONFIG)
    : path.join(root, "jobpilot.config.yaml");
  let raw: unknown = {};
  try {
    raw = parseYaml(readFileSync(configPath, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  const parsed = ConfigSchema.parse(raw ?? {});
  const configRoot = path.dirname(configPath);
  const abs = (value: string) => (path.isAbsolute(value) ? value : path.resolve(configRoot, value));
  return {
    ...parsed,
    root: configRoot,
    database: process.env.JOBPILOT_DB ? path.resolve(process.env.JOBPILOT_DB) : abs(parsed.database),
    facts: process.env.JOBPILOT_FACTS ? path.resolve(process.env.JOBPILOT_FACTS) : abs(parsed.facts),
    resume: process.env.JOBPILOT_RESUME ? path.resolve(process.env.JOBPILOT_RESUME) : abs(parsed.resume),
    watchlist: abs(parsed.watchlist),
    roleFamilies: parsed.roleFamilies,
    llm: {
      provider: (process.env.JOBPILOT_LLM as AppConfig["llm"]["provider"] | undefined) ?? parsed.llm.provider,
      baseUrl: process.env.JOBPILOT_LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? parsed.llm.baseUrl,
      model: process.env.JOBPILOT_LLM_MODEL ?? parsed.llm.model,
    },
  };
}
