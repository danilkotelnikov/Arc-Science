export const meta = {
  name: 'hoh',
  description: 'Bounded Harness-of-Harness: plan the smallest increment, then independent adversarial QA of the working tree',
  phases: [{ title: 'Plan' }, { title: 'Independent QA' }, { title: 'Synthesize' }],
}

// Task comes from Workflow args: { task: string, lenses?: string[] }.
const task = (args && args.task) || (typeof args === 'string' ? args : 'the current increment')
const LENSES = (args && args.lenses) || [
  'correctness & edge cases: wrong output, panics/unwraps on untrusted input, off-by-one, error handling',
  'concurrency & resources: races, deadlocks, lock ordering, unbounded growth, leaked processes/handles, cleanup',
  'security & boundaries: untrusted input, injection, a caller-supplied scope acting as an access grant, provenance/trust',
  'evidence: do the stated tests and acceptance actually hold, or is something claimed but unproven?',
]

phase('Plan')
const plan = await agent(
  `You are the PLANNER in a Harness-of-Harness cycle. Task: ${task}\n` +
    `Read the repository as needed. Produce the SMALLEST bounded increment that advances the task: ` +
    `the concrete change, the files it touches, the acceptance evidence to gather, and the boundary you will NOT cross. ` +
    `Do NOT implement anything. Return a concise plan only.`,
  { phase: 'Plan', label: 'plan' },
)

phase('Independent QA')
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
          location: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'location', 'problem'],
      },
    },
  },
  required: ['findings'],
}
const reviews = await parallel(
  LENSES.map((lens, i) => () =>
    agent(
      `You are an INDEPENDENT adversarial reviewer (NOT the author) in a Harness-of-Harness cycle.\n` +
        `Task under review: ${task}\n` +
        `Inspect the working tree: run \`git --no-pager diff\` and \`git --no-pager diff --staged\`, then read the touched files.\n` +
        `Lens: ${lens}\n` +
        `Try to REFUTE the work. Report only defects you can substantiate with a concrete file:line and a failing scenario. ` +
        `If you find nothing real under this lens, return an empty findings list. Do not praise, do not restate the diff.`,
      { phase: 'Independent QA', label: `qa:${i}`, schema: REVIEW_SCHEMA, effort: 'high' },
    ),
  ),
)

phase('Synthesize')
const rank = { blocking: 0, major: 1, minor: 2 }
const findings = reviews
  .filter(Boolean)
  .flatMap((r) => r.findings || [])
  .sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3))
log(`HoH QA: ${findings.length} findings (${findings.filter((f) => f.severity === 'blocking').length} blocking)`)
return { plan, findings, blocking: findings.filter((f) => f.severity === 'blocking').length }
