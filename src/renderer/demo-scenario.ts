import type { Insight, InsightActionItem } from './services/insightsService'

type TranscriptLike = { text?: string }

export const DEMO_PREP_THINKING_MS = 1000
export const DEMO_LIVE_THINKING_MS = 400
export const DEMO_POST_THINKING_MS = 400

export type DemoAskResponse = { content: string; delayMs: number }

const DURING_ACTIONS: InsightActionItem[] = [
  { label: '💬 What should I say next?', icon: 'chat', prompt: 'What should I say next?' },
  { label: '✨ Reframe the objection', icon: 'sparkle', prompt: 'Reframe the objection' },
  { label: '❓ Surface cost of inaction', icon: 'question', prompt: 'Surface cost of inaction' },
]

const AFTER_ACTIONS: InsightActionItem[] = [
  { label: '📧 Follow-up Email', icon: 'mail', prompt: 'Follow-up Email' },
  { label: '📞 Plan follow-up', icon: 'phone', prompt: 'Plan follow-up' },
  { label: '📋 Action Items', icon: 'check', prompt: 'Action Items' },
  { label: '📊 Update CRM', icon: 'chart', prompt: 'Update CRM' },
  { label: '📝 Summary', icon: 'note', prompt: 'Summary' },
]

export const DEMO_PREP_RESPONSE = [
  '**From your last calls**',
  '- Objection you lost to twice: "Reps just read off screens." Counter loaded.',
  '- Your best rep wins this objection by reframing dependence as guided practice.',
  '',
  '**Prospect**',
  '- Anista: 67 reps, average ramp 9 months, turnover 34%.',
  '- Primary risk: junior reps know the playbook but freeze live.',
  '',
  '**Playbook**',
  '- Reframe price to cost of inaction.',
  '- Quantify the last winnable deal a junior rep lost.',
].join('\n')

export const DEMO_HERO_RESPONSE = [
  "Pilots don't learn by crashing. They use tools to win.",
  'Ask: "What did the last deal a junior lost cost you?"',
].join('\n\n')

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()

export function getDemoAskResponse(
  prompt: string,
  sessionState: 'before' | 'during' | 'after',
): DemoAskResponse | null {
  const normalized = normalize(prompt)

  if (
    sessionState === 'before' &&
    normalized.includes('anista') &&
    /(prepare|prep|vorbereit)/.test(normalized)
  ) {
    return { content: DEMO_PREP_RESPONSE, delayMs: DEMO_PREP_THINKING_MS }
  }

  if (
    sessionState === 'during' &&
    (
      normalized.includes('what should i say next') ||
      normalized.includes('was soll ich als nächstes sagen') ||
      normalized.includes('was soll ich als naechstes sagen')
    )
  ) {
    return { content: DEMO_HERO_RESPONSE, delayMs: DEMO_LIVE_THINKING_MS }
  }

  return null
}

function transcriptText(transcripts: TranscriptLike[]): string {
  return normalize(transcripts.map((entry) => entry.text || '').join(' '))
}

function hasQuantifiedCost(text: string): boolean {
  return /(forty grand|40\s*grand|40[,.]?000|40k|[$€]\s?40(?:[,.]?000|k)?|vierzigtausend|vierzig tausend)/.test(text)
}

function hasSkillTransferReframe(text: string): boolean {
  return /(in their head|not on the screen|not on screen|nicht mehr auf dem bildschirm|im kopf)/.test(text)
}

export function buildDemoInsights(
  sessionState: 'during' | 'after',
  transcripts: TranscriptLike[],
): Insight {
  if (sessionState === 'after') {
    const prospectInfo = [
      'Agreed next step: 2-week pilot with 10 reps.',
      'Buying signal: the last junior-lost deal cost about €40,000.',
      'Primary concern: reps must internalize the skill, not depend on scripts.',
    ]
    const salesAnalysis = [
      'Key moment: Anton raised the skill-dependency objection.',
      'You said: "Pilots don\'t learn by crashing. They use tools to win."',
      'Your #1 rep would say: quantify the last lost deal, then contrast it with the pilot.',
      'Past-call learning: the recurring script-dependency objection and winning counter were retained.',
      'Next meeting: open with pilot results and ROI proof; the counter is loaded for the next call.',
    ]

    return {
      summary: prospectInfo,
      prospect_info: prospectInfo,
      sales_analysis: salesAnalysis,
      meeting_title: 'Insights',
      topic: { header: 'Sales Analysis', bullets: salesAnalysis },
      actions: AFTER_ACTIONS.map((action) => action.label),
      action_items: AFTER_ACTIONS,
      followUpActions: [],
      followUps: [],
      session_state: 'after',
      stub: false,
    }
  }

  const combinedTranscript = transcriptText(transcripts)
  const salesAnalysis = [
    'Skill-dependency objection is active: reframe Taylos as guided practice, not a script reader.',
    'Quantify the cost of the last winnable deal a junior rep lost.',
  ]

  if (hasQuantifiedCost(combinedTranscript)) {
    salesAnalysis.push('Buying signal detected: a lost deal costs about €40,000.')
  }
  if (hasSkillTransferReframe(combinedTranscript)) {
    salesAnalysis.push('Close: 2-week pilot | 10 reps.')
  }

  const prospectInfo = [
    'Anista: 67 reps; average ramp 9 months; turnover 34%.',
    'Junior reps know the playbook but freeze on pricing and security objections.',
    'Past calls: "Reps just read off screens" was lost twice; the winning counter is loaded.',
  ]

  return {
    summary: prospectInfo,
    prospect_info: prospectInfo,
    sales_analysis: salesAnalysis,
    meeting_title: 'Insights',
    topic: { header: 'Sales Analysis', bullets: salesAnalysis },
    actions: DURING_ACTIONS.map((action) => action.label),
    action_items: DURING_ACTIONS,
    followUpActions: [],
    followUps: [],
    session_state: 'during',
    stub: false,
  }
}
