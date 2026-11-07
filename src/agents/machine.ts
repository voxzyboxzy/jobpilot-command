import type { HistoryEntry, Stage } from "../types.js";

/**
 * Explicit pipeline graph. Agents may move a job only along these edges.
 *
 * discovered -> eligible | ineligible
 * ineligible -> eligible
 * eligible -> ranked | ineligible
 * ranked -> tailored | eligible | ineligible
 * tailored -> reviewed
 * reviewed -> awaiting_approval | blocked
 * awaiting_approval -> approved | tailored
 * approved -> awaiting_approval | filling
 * blocked -> tailored
 * filling -> stopped | handoff | submitted
 * stopped -> filling | awaiting_approval
 * handoff -> filling
 * submitted -> (terminal)
 */
const TRANSITIONS: Record<Stage, Stage[]> = {
  discovered: ["eligible", "ineligible"],
  ineligible: ["eligible"],
  eligible: ["ranked", "ineligible"],
  ranked: ["tailored", "eligible", "ineligible"],
  tailored: ["reviewed"],
  reviewed: ["awaiting_approval", "blocked"],
  awaiting_approval: ["approved", "tailored"],
  approved: ["awaiting_approval", "filling"],
  blocked: ["tailored"],
  filling: ["stopped", "handoff", "submitted"],
  stopped: ["filling", "awaiting_approval"],
  handoff: ["filling"],
  submitted: [],
};

export class IllegalTransition extends Error {
  constructor(from: Stage, to: Stage) {
    super(`Illegal pipeline transition ${from} -> ${to}`);
    this.name = "IllegalTransition";
  }
}

export class PipelineMachine {
  stage: Stage;
  history: HistoryEntry[];

  constructor(stage: Stage, history: HistoryEntry[]) {
    this.stage = stage;
    this.history = history;
  }

  static start(at: string): PipelineMachine {
    return new PipelineMachine("discovered", [
      { from: null, to: "discovered", actor: "scout", note: "Posting stored.", at },
    ]);
  }

  can(to: Stage): boolean {
    return TRANSITIONS[this.stage].includes(to);
  }

  transition(to: Stage, actor: string, note: string, at: string): void {
    if (!this.can(to)) throw new IllegalTransition(this.stage, to);
    const from = this.stage;
    this.stage = to;
    this.history = [...this.history, { from, to, actor, note, at }];
  }
}

export function allowedTransitions(from: Stage): Stage[] {
  return [...TRANSITIONS[from]];
}
