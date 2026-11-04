// arc-hoh 0.2.0 (2026-10-31): the tools and prompt sections. No arc imports here, so node can test it.
import { appendLedger, hashFiles, lastEvent, ledgerFile, verifyLedger, decideGate } from './gates.js';
import { CONTRACT, briefText } from './contract.js';
import { retainNote } from './brief.js';

const strList = { type: 'array', items: { type: 'string' } };
const clip = (s, n = 600) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '...' : s);

/** The id the runtime reports for the calling agent, or null when it reports none. */
export function callerOf(exec) {
  const a = exec && exec.agent;
  const id = a && (a.id ?? (a.session && a.session.id));
  return typeof id === 'string' && id !== '' ? id : null;
}

export function makeTools(defineTool, env = process.env, deps = {}) {
  const file = () => ledgerFile(env);
  const retain = deps.retain || retainNote;
  const retainOn = () => env.ARC_HOH_RETAIN !== '0';

  const propose = defineTool({
    name: 'hoh_propose',
    description: 'Harness^2 Propose step, before you build. Record the task hypothesis, the boundary, the acceptance checks and the probes (edge cases and rival options) you will run. hoh_freeze refuses a goal that has no proposal.',
    parameters: {
      goal: { type: 'string', required: true, description: 'Short name of the task. Propose, freeze and gate must use the same name.' },
      hypothesis: { type: 'string', required: true, description: 'What you believe will solve the task and why.' },
      boundary: { type: 'string', required: true, description: 'The files and behaviour you will not touch.' },
      checks: { ...strList, required: true, description: 'The acceptance checks, each a command or an observable result.' },
      probes: { ...strList, required: true, description: 'The edge cases and rival options you will test.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { seq: { type: 'integer', required: true } } },
      render: (_args, v) => [{ type: 'text', text: `Proposal recorded (ledger entry ${v.seq}).` }],
    },
    async execute(args, exec) {
      if (!Array.isArray(args.checks) || args.checks.length === 0) throw new Error('hoh_propose needs at least one acceptance check');
      if (!Array.isArray(args.probes) || args.probes.length === 0) throw new Error('hoh_propose needs at least one probe');
      const { seq } = await appendLedger(file(), {
        type: 'propose', goal: args.goal, caller: callerOf(exec), hypothesis: clip(args.hypothesis), boundary: clip(args.boundary),
        checks: args.checks.map((c) => clip(c, 300)), probes: args.probes.map((c) => clip(c, 300)),
      });
      return { seq };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Propose (Harness^2)', kind: 'other', rawInput: { goal: args.goal } }),
  });

  const freeze = defineTool({
    name: 'hoh_freeze',
    description: 'HoH step 5. Freeze the candidate: hash the files that make up the work and record it in the ledger. The goal needs a proposal first. Any later edit makes a new candidate, so freeze again after a fix. Pass absolute paths of regular files.',
    parameters: {
      goal: { type: 'string', required: true, description: 'Short name of the task. It must match the proposal and the gate.' },
      files: { ...strList, required: true, description: 'Absolute paths of the files that make up the candidate.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { candidate: { type: 'string', required: true }, files: { type: 'integer', required: true }, seq: { type: 'integer', required: true } },
      },
      render: (_args, v) => [{ type: 'text', text: `Frozen ${v.files} file(s). Candidate ${v.candidate} (ledger entry ${v.seq}).` }],
    },
    async execute(args, exec) {
      if (!(await lastEvent(file(), args.goal, 'propose'))) throw new Error(`hoh_freeze: no proposal for goal "${args.goal}". Call hoh_propose first.`);
      const { candidate, files, paths } = await hashFiles(args.files);
      const { seq } = await appendLedger(file(), { type: 'freeze', goal: args.goal, caller: callerOf(exec), candidate, files, paths });
      return { candidate, files, seq };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Freeze candidate', kind: 'other', rawInput: args }),
  });

  const gate = defineTool({
    name: 'hoh_gate',
    description: 'HoH step 10. The reviewer calls this, not the agent that froze the candidate. It accepts only when: a proposal and a freeze exist; the files still match the freeze; every check exited 0 with an excerpt; every probe passed; the reviewer is not the builder and not the agent that froze; the preservation list holds; no blocking or major finding is open; every requirement is verified. Missing evidence is unmet. The verdict is written to the ledger and to Cammut.',
    parameters: {
      goal: { type: 'string', required: true, description: 'The same goal name as in hoh_propose and hoh_freeze.' },
      candidate: { type: 'string', required: true, description: 'The candidate id that hoh_freeze returned.' },
      cycle: { type: 'integer', required: true, description: 'Which HoH cycle this is, from 1. Past 3 the gate blocks and you must ask the user.' },
      builder: { type: 'string', required: true, description: 'Id or name of the agent that built the work.' },
      reviewer: { type: 'string', required: true, description: 'Id or name of the different agent that ran the checks.' },
      checks: {
        type: 'array', required: true, description: 'Each acceptance check with its command, exit code and a short output excerpt.',
        items: { type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true }, command: { type: 'string', required: true },
          exit: { type: 'integer', required: true }, excerpt: { type: 'string', required: true } } },
      },
      probes: {
        type: 'array', required: true, description: 'Each probe (edge case or rival option) with its result.',
        items: { type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true }, description: { type: 'string', required: true },
          result: { type: 'string', required: true, enum: ['pass', 'fail'] } } },
      },
      preservation: {
        type: 'array', required: true, description: 'Earlier behaviour that must still hold, each confirmed or not.',
        items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, ok: { type: 'boolean', required: true } } },
      },
      findings: {
        type: 'array', description: 'Reviewer findings. A blocking or major finding that is still open stops acceptance.',
        items: { type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true }, severity: { type: 'string', required: true, enum: ['blocking', 'major', 'minor'] },
          status: { type: 'string', required: true, enum: ['open', 'fixed', 'rejected'] }, reason: { type: 'string' } } },
      },
      requirements: {
        type: 'array', required: true, description: 'Each requirement with its state. Only verified counts. The list must not be empty.',
        items: { type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true }, state: { type: 'string', required: true, enum: ['verified', 'failed', 'unverified', 'blocked'] } } },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          verdict: { type: 'string', required: true, enum: ['accepted', 'unmet', 'blocked'] },
          reasons: { ...strList, required: true }, seq: { type: 'integer', required: true }, retained: { type: 'boolean', required: true },
        },
      },
      render: (_args, v) => [{ type: 'text', text: (v.verdict === 'accepted' ? `Accepted (ledger entry ${v.seq}).` : `${v.verdict}: ${v.reasons.join('; ')}`) + (v.retained ? ' Written to Cammut.' : ' Not written to Cammut.') }],
    },
    async execute(args, exec) {
      const freezeRow = await lastEvent(file(), args.goal, 'freeze');
      const proposeRow = await lastEvent(file(), args.goal, 'propose');
      let fileCheck = null;
      if (freezeRow && Array.isArray(freezeRow.paths)) {
        try {
          const now = await hashFiles(freezeRow.paths);
          fileCheck = now.candidate === freezeRow.candidate ? { ok: true } : { ok: false, reason: 'the content hash differs from the frozen one' };
        } catch (err) {
          fileCheck = { ok: false, reason: String((err && err.message) || err).slice(0, 160) };
        }
      }
      const caller = callerOf(exec);
      const { verdict, reasons } = decideGate(args, { freeze: freezeRow, propose: proposeRow, fileCheck, caller });
      const { seq } = await appendLedger(file(), {
        type: 'gate', goal: args.goal, candidate: args.candidate, cycle: args.cycle, verdict, reasons, caller,
        builder: args.builder, reviewer: args.reviewer, checks: (args.checks || []).map((c) => c.id),
      });
      let retained = false;
      if (retainOn()) {
        const day = new Date().toISOString().slice(0, 10);
        retained = await retain({
          content: `HoH gate for goal "${clip(args.goal, 80)}", cycle ${args.cycle}: ${verdict}. ${reasons.length ? clip(reasons.join('; '), 400) : 'Every check, probe and requirement held.'} Candidate ${String(args.candidate).slice(0, 19)}.`,
          context: 'Written automatically by the arc-hoh accept gate (Harness^2 carry-over)',
          tags: [process.env.ARC_HOH_PROJECT_TAG || 'project:arc-harness', 'source:arc-harness', 'hoh:slice', `date:${day}`],
        });
      }
      return { verdict, reasons, seq, retained: retained === true };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Acceptance gate', kind: 'other', rawInput: { goal: args.goal, cycle: args.cycle } }),
  });

  const verify = defineTool({
    name: 'hoh_verify_ledger',
    description: 'Check that the HoH ledger chain is intact. Each entry holds the hash of the entry before it.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, entries: { type: 'integer', required: true }, badAt: { type: 'integer', required: true } },
      },
      render: (_args, v) => [{ type: 'text', text: v.ok ? `Ledger intact (${v.entries} entries).` : `Ledger broken at entry ${v.badAt}.` }],
    },
    async execute() {
      return verifyLedger(file());
    },
    presentCall: () => ({ card: 'generic', title: 'Verify HoH ledger', kind: 'other', rawInput: {} }),
  });

  return [propose, freeze, gate, verify];
}

/** Prompt sections. getBrief returns the current Cammut brief text. */
export function registerPrompt(systemPrompt, getBrief) {
  systemPrompt.section({ name: 'hoh:operating-contract', order: 9500, text: CONTRACT, interpolate: false });
  systemPrompt.variable('hoh_brief', () => briefText(getBrief()));
  systemPrompt.section({ name: 'hoh:cammut-brief', order: 9510, text: '{{hoh_brief}}' });
}
