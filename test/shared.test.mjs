import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyCompactionEditEvent,
  computeReplaceSpan,
  createInitialCompactionEditState,
  extractSummaryText,
  hasOpenBoundary,
  isCheckpointEvent,
  reframeCheckpointContent,
  sumSpanTokens,
  textFromBlocks,
  viewOfCompactionEdit,
} from '../lib/shared.js'

/**
 * Build a compact Session-event fixture.
 * @param type - event type.
 * @param seq - event seq.
 * @param data - event payload.
 * @param extra - extra event fields.
 * @returns event fixture.
 */
function event(type, seq, data, extra = {}) {
  return { type, seq, time: seq, data, ...extra }
}

/**
 * Build a compaction start event.
 * @param seq - event seq.
 * @param compactionId - compaction identity.
 * @param commandId - optional command identity.
 * @returns event.
 */
function start(seq, compactionId, commandId) {
  return event('compaction/start', seq, {
    compactionId,
    ...(commandId === undefined ? {} : { sourceCommandId: commandId }),
    turn: null,
  })
}

/**
 * Build a compaction summary event.
 * @param seq - event seq.
 * @param compactionId - compaction identity.
 * @param text - summary text.
 * @param commandId - optional command identity.
 * @returns event.
 */
function summary(seq, compactionId, text, commandId) {
  return event('compaction/summary', seq, {
    compactionId,
    ...(commandId === undefined ? {} : { sourceCommandId: commandId }),
    summary: [{ type: 'text', text }],
    shadowedRange: { start: 0, end: 0 },
    shadowedSeqs: [0],
    shadowedTokenCount: 1,
    provider: 'deepseek',
    model: 'deepseek-flash',
  })
}

/**
 * Build a checkpoint replacement event.
 * @param seq - event seq.
 * @param compactionId - compaction identity.
 * @param commandId - optional command identity.
 * @param checkpointSeq - replaced seq.
 * @returns event.
 */
function checkpoint(seq, compactionId, commandId, checkpointSeq = 0) {
  return event(
    'user/message',
    seq,
    {
      id: `message-${seq}`,
      role: 'user',
      content: [
        { type: 'text', text: 'Preamble\n\n<compacted-summary>' },
        { type: 'text', text: 'old summary' },
        { type: 'text', text: '</compacted-summary>' },
      ],
      source: {
        kind: 'compact-checkpoint',
        compactionId,
        ...(commandId === undefined ? {} : { sourceCommandId: commandId }),
      },
    },
    {
      surfaceOp: { op: 'replace', startSeq: checkpointSeq, endSeq: checkpointSeq },
      sourceEventSeqs: [seq - 2, seq - 1, checkpointSeq],
    },
  )
}

/**
 * Build a compaction end event.
 * @param seq - event seq.
 * @param compactionId - compaction identity.
 * @param commandId - optional command identity.
 * @param error - optional error.
 * @returns event.
 */
function end(seq, compactionId, commandId, error) {
  return event('compaction/end', seq, {
    compactionId,
    ...(commandId === undefined ? {} : { sourceCommandId: commandId }),
    turn: null,
    ...(error === undefined ? {} : { error }),
  })
}

/**
 * Fold a list of events through the projection.
 * @param events - events.
 * @returns final state.
 */
function fold(events) {
  let state = createInitialCompactionEditState()
  for (const item of events) state = applyCompactionEditEvent(state, item)
  return state
}

test('initial state exposes an empty stable view', () => {
  const state = createInitialCompactionEditState()
  assert.equal(state.latestCompactionId, null)
  assert.deepEqual(viewOfCompactionEdit(state), {
    compactionId: null,
    checkpointSeq: null,
    started: false,
    commandId: null,
    summary: null,
    replaceCount: 0,
    replaceTokens: 0,
    tailCount: 0,
    spanCount: 0,
    canRemove: false,
  })
})

test('manual compaction becomes the current card with its command id', () => {
  const state = fold([
    start(0, 'c1', 'cmd1'),
    summary(1, 'c1', 'old', 'cmd1'),
    checkpoint(2, 'c1', 'cmd1'),
    end(3, 'c1', 'cmd1'),
  ])
  assert.equal(state.latestCompactionId, 'c1')
  assert.equal(state.latestCommandId, 'cmd1')
  assert.equal(state.latestSummarySeq, 1)
  assert.equal(state.latestCheckpointSeq, 2)
  assert.deepEqual(viewOfCompactionEdit(state), {
    compactionId: 'c1',
    checkpointSeq: 2,
    started: false,
    commandId: 'cmd1',
    summary: 'old',
    replaceCount: 1,
    replaceTokens: 1,
    tailCount: 0,
    spanCount: 1,
    canRemove: false,
  })
})

test('automatic compaction becomes the current card without a command id', () => {
  const state = fold([
    start(0, 'auto1'),
    summary(1, 'auto1', 'old'),
    checkpoint(2, 'auto1'),
    end(3, 'auto1'),
  ])
  assert.equal(state.latestCompactionId, 'auto1')
  assert.equal(state.latestCommandId, null)
})

test('active edits do not publish a new view', () => {
  let state = fold([
    start(0, 'c1', 'cmd1'),
    summary(1, 'c1', 'old', 'cmd1'),
    checkpoint(2, 'c1', 'cmd1'),
    end(3, 'c1', 'cmd1'),
  ])
  const view = state.view

  state = applyCompactionEditEvent(state, start(4, 'c2', 'cmd2'))
  assert.equal(state.view, view)
  state = applyCompactionEditEvent(state, summary(5, 'c2', 'next', 'cmd2'))
  assert.equal(state.view, view)
  state = applyCompactionEditEvent(state, checkpoint(6, 'c2', 'cmd2', 2))
  assert.equal(state.view, view)
})

test('a failed compaction keeps the previous card', () => {
  let state = fold([
    start(0, 'c1', 'cmd1'),
    summary(1, 'c1', 'old', 'cmd1'),
    checkpoint(2, 'c1', 'cmd1'),
    end(3, 'c1', 'cmd1'),
  ])
  const view = state.view

  state = applyCompactionEditEvent(state, start(4, 'c2', 'cmd2'))
  state = applyCompactionEditEvent(state, end(5, 'c2', 'cmd2', 'summary too large'))

  assert.equal(state.latestCompactionId, 'c1')
  assert.equal(state.latestCheckpointSeq, 2)
  assert.equal(state.view, view)
})

test('a second edit transaction on the same card updates the checkpoint', () => {
  let state = fold([
    start(0, 'c1', 'cmd1'),
    summary(1, 'c1', 'old', 'cmd1'),
    checkpoint(2, 'c1', 'cmd1'),
    end(3, 'c1', 'cmd1'),
  ])
  const view = state.view

  state = fold([
    start(4, 'c1', 'cmd1'),
    summary(5, 'c1', 'edited', 'cmd1'),
    checkpoint(6, 'c1', 'cmd1', 2),
    end(7, 'c1', 'cmd1'),
  ])

  assert.equal(state.latestCompactionId, 'c1')
  assert.equal(state.latestCheckpointSeq, 6)
  assert.equal(state.latestSummarySeq, 5)
  assert.notEqual(state.view, view)
  assert.deepEqual(viewOfCompactionEdit(state), {
    compactionId: 'c1',
    checkpointSeq: 6,
    started: false,
    commandId: 'cmd1',
    summary: 'edited',
    replaceCount: 1,
    replaceTokens: 1,
    tailCount: 0,
    spanCount: 1,
    canRemove: false,
  })
})

test('a post-compaction user message starts the conversation', () => {
  let state = fold([
    start(0, 'c1', 'cmd1'),
    summary(1, 'c1', 'old', 'cmd1'),
    checkpoint(2, 'c1', 'cmd1'),
    end(3, 'c1', 'cmd1'),
  ])
  state = applyCompactionEditEvent(
    state,
    event('user/message', 4, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'next question' }],
    }),
  )
  assert.equal(state.view.started, true)
})

test('a new compaction resets started and a same-card edit preserves it', () => {
  let state = fold([
    start(0, 'c1', 'cmd1'),
    summary(1, 'c1', 'old', 'cmd1'),
    checkpoint(2, 'c1', 'cmd1'),
    end(3, 'c1', 'cmd1'),
    event('user/message', 4, { source: { kind: 'user' }, content: [] }),
  ])
  assert.equal(state.view.started, true)

  state = fold([
    start(5, 'c2', 'cmd2'),
    summary(6, 'c2', 'next', 'cmd2'),
    checkpoint(7, 'c2', 'cmd2', 2),
    end(8, 'c2', 'cmd2'),
  ])
  assert.equal(state.view.compactionId, 'c2')
  assert.equal(state.view.started, false)

  state = applyCompactionEditEvent(state, event('user/message', 9, {
    source: { kind: 'user' },
    content: [],
  }))
  assert.equal(state.view.started, true)

  state = applyCompactionEditEvent(state, start(10, 'c2', 'cmd2'))
  state = applyCompactionEditEvent(state, summary(11, 'c2', 'edited', 'cmd2'))
  state = applyCompactionEditEvent(state, checkpoint(12, 'c2', 'cmd2', 7))
  state = applyCompactionEditEvent(state, end(13, 'c2', 'cmd2'))
  assert.equal(state.view.compactionId, 'c2')
  assert.equal(state.view.started, true)
})

test('a later successful compaction moves the edit entry', () => {
  const state = fold([
    start(0, 'c1', 'cmd1'),
    summary(1, 'c1', 'old', 'cmd1'),
    checkpoint(2, 'c1', 'cmd1'),
    end(3, 'c1', 'cmd1'),
    start(4, 'c2'),
    summary(5, 'c2', 'next'),
    checkpoint(6, 'c2', undefined, 2),
    end(7, 'c2'),
  ])
  assert.equal(state.latestCompactionId, 'c2')
  assert.equal(state.latestCheckpointSeq, 6)
  assert.equal(state.latestCommandId, null)
})

test('irrelevant events keep the same state reference', () => {
  const state = createInitialCompactionEditState()
  assert.equal(applyCompactionEditEvent(state, event('assistant/message', 0, {})), state)
})

test('replacement checkpoint recognition', () => {
  const item = checkpoint(2, 'c1', 'cmd1')
  assert.equal(isCheckpointEvent(item), true)
  assert.equal(
    isCheckpointEvent({
      type: 'user/message',
      data: { source: { kind: 'user' } },
      surfaceOp: 'append',
    }),
    false,
  )
})

test('current span runs from the checkpoint to the surface end', () => {
  assert.deepEqual(computeReplaceSpan([10, 11, 12, 13], 11), [11, 12, 13])
  assert.equal(computeReplaceSpan([10, 11], 99), null)
  assert.equal(computeReplaceSpan(null, 1), null)
})

test('span token sum uses heuristic tokens', () => {
  const measurement = {
    nodes: [
      { seq: 10, heuristicTokens: 5, tokens: 7 },
      { seq: 11, heuristicTokens: 8, tokens: 9 },
      { seq: 12, heuristicTokens: 2, tokens: 3 },
    ],
  }
  assert.equal(sumSpanTokens(measurement, [10, 12]), 7)
  assert.equal(sumSpanTokens(measurement, []), 0)
  assert.equal(sumSpanTokens({}, [10]), 0)
})

test('open turn and open compaction are busy', () => {
  const base = [event('turn/start', 0, { turn: 1 })]
  assert.equal(hasOpenBoundary(base), true)
  assert.equal(hasOpenBoundary([...base, event('turn/end', 1, { turn: 1 })]), false)

  const compaction = [event('compaction/start', 0, { compactionId: 'c' })]
  assert.equal(hasOpenBoundary(compaction), true)
  assert.equal(
    hasOpenBoundary([...compaction, event('compaction/end', 1, { compactionId: 'c' })]),
    false,
  )
  assert.equal(
    hasOpenBoundary([...compaction, event('session/end-seed', 1, { inherited: true })]),
    false,
  )
})

test('text and summary extraction preserve the framed body', () => {
  const content = [
    { type: 'text', text: 'Preamble\n\n<compacted-summary>' },
    { type: 'text', text: 'line one\nline two' },
    { type: 'text', text: '</compacted-summary>' },
    { type: 'image', attachment: {} },
  ]
  assert.equal(
    textFromBlocks(content),
    'Preamble\n\n<compacted-summary>line one\nline two</compacted-summary>',
  )
  assert.equal(extractSummaryText(content), 'line one\nline two')
})

test('reframing keeps the preamble and tags', () => {
  const content = [
    { type: 'text', text: 'Preamble\n\n<compacted-summary>' },
    { type: 'text', text: 'old' },
    { type: 'text', text: '</compacted-summary>' },
  ]
  const blocks = reframeCheckpointContent(content, 'new text')
  assert.deepEqual(blocks, [
    { type: 'text', text: 'Preamble\n\n<compacted-summary>' },
    { type: 'text', text: 'new text' },
    { type: 'text', text: '</compacted-summary>' },
  ])
})

test('reframing without tags falls back to the edited text', () => {
  assert.deepEqual(reframeCheckpointContent([{ type: 'text', text: 'plain' }], 'edited'), [
    { type: 'text', text: 'edited' },
  ])
})
