import assert from 'node:assert/strict'
import test from 'node:test'

import { operationBody, runOperation } from '../index.js'

const SURFACE_TYPES = new Set([
  'assistant/message',
  'tool/result',
  'user/message',
  'system/message',
  'developer/message',
])

/**
 * In-memory Session/Context fixture for the Host operation surface.
 * It mirrors the committed-event and surface contracts the plugin reads.
 */
function createFixture(options = {}) {
  const sourceCommandId = options.auto === true ? undefined : 'cmd-1'
  const events = []
  const surface = []
  const session = {
    inheritedEventCount: 0,
    _seq: -1,
    get seq() {
      return this._seq
    },
    get surface() {
      return { nodes: [...surface] }
    },
    append(type, data, options = {}) {
      const seq = ++this._seq
      const event = { type, seq, time: seq, data, ...options }
      events.push(event)
      if (SURFACE_TYPES.has(type)) {
        const op = options.surfaceOp
        if (op?.op === 'replace') {
          const start = surface.indexOf(op.startSeq)
          const end = surface.indexOf(op.endSeq)
          if (start >= 0 && end >= start) surface.splice(start, end - start + 1, seq)
          else surface.push(seq)
        } else {
          surface.push(seq)
        }
      }
      return event
    },
    snapshotEvents(from, to) {
      return events.filter((event) => event.seq >= from && event.seq <= to)
    },
  }

  const ctx = {
    logger: { warn() {} },
    sessionController: {
      async resolveAgent(sessionId) {
        return { agent: { id: sessionId } }
      },
    },
    sessions: {
      get(sessionId) {
        return sessionId === 's1' ? session : undefined
      },
      async flush() {},
    },
    sessionProjections: {
      stateOf() {
        return undefined
      },
    },
    tokenMeter: {
      measure() {
        return { nodes: surface.map((seq) => ({ seq, heuristicTokens: 1 })) }
      },
    },
  }

  const checkpoint = (text) => {
    const old = surface[surface.length - 1]
    return session.append(
      'user/message',
      {
        id: `checkpoint-${session.seq + 1}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: {
          kind: 'compact-checkpoint',
          compactionId: 'card-1',
          sourceCommandId,
        },
      },
      {
        surfaceOp: { op: 'replace', startSeq: old, endSeq: old },
        sourceEventSeqs: [old],
      },
    )
  }

  const summary = (text) =>
    session.append('compaction/summary', {
      compactionId: 'card-1',
      sourceCommandId,
      summary: [{ type: 'text', text }],
      shadowedRange: { start: 0, end: 0 },
      shadowedSeqs: [surface[0]],
      shadowedTokenCount: 1,
      provider: 'deepseek',
      model: 'deepseek-flash',
    })

  // A normal conversation: system + one compacted user node + card + tail.
  session.append('system/message', { content: [{ type: 'text', text: 'system' }] })
  session.append('user/message', {
    source: { kind: 'user' },
    message: {
      id: 'msg-before',
      role: 'user',
      content: [{ type: 'text', text: 'before compaction' }],
    },
  })
  session.append('compaction/start', {
    compactionId: 'card-1',
    sourceCommandId,
    turn: null,
  })
  summary('initial summary')
  checkpoint('initial checkpoint')
  session.append('compaction/end', {
    compactionId: 'card-1',
    sourceCommandId,
    turn: null,
  })
  session.append('assistant/message', {
    message: {
      id: 'msg-tail',
      role: 'assistant',
      content: [{ type: 'text', text: 'tail answer' }],
    },
  })

  return { ctx, session, events }
}

/**
 * Join the text blocks of a checkpoint message.
 * @param event - user/message event.
 * @returns joined text.
 */
function messageText(event) {
  return (event.data?.content ?? [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
}

test('acceptance: status, normal edit, remove/edit and branch message lookup', async () => {
  const { ctx, session, events } = createFixture()
  const surfaceBefore = session.surface.nodes
  const tailSeq = surfaceBefore[surfaceBefore.length - 1]

  const status = await runOperation(ctx, { op: 'status', sessionId: 's1' })
  assert.equal(status.ok, true)
  assert.equal(status.compactionId, 'card-1')
  assert.equal(status.replaceCount, 1)
  assert.equal(status.tailCount, 1)
  assert.equal(status.canRemove, true)
  assert.equal(status.started, false)

  const message = await runOperation(ctx, {
    op: 'messageSeq',
    sessionId: 's1',
    messageId: 'msg-tail',
  })
  assert.deepEqual(message, { ok: true, seq: 6 })

  const edited = await runOperation(ctx, {
    op: 'apply',
    sessionId: 's1',
    compactionId: 'card-1',
    text: 'edited checkpoint',
  })
  assert.equal(edited.ok, true, JSON.stringify(edited))
  const afterEdit = await runOperation(ctx, { op: 'status', sessionId: 's1' })
  assert.equal(afterEdit.tailCount, 1, 'normal edit keeps the official tail')
  assert.equal(afterEdit.summary, 'edited checkpoint')
  const surfaceAfterEdit = session.surface.nodes
  assert.equal(surfaceAfterEdit.length, surfaceBefore.length)
  assert.equal(surfaceAfterEdit[0], surfaceBefore[0])
  assert.notEqual(surfaceAfterEdit[1], surfaceBefore[1])
  assert.equal(surfaceAfterEdit[2], tailSeq, 'the official tail stays on the surface')
  const editedCheckpoint = events
    .filter((event) => event.type === 'user/message' && event.data?.source?.kind === 'compact-checkpoint')
    .at(-1)
  assert.equal(messageText(editedCheckpoint), 'edited checkpoint')

  const removed = await runOperation(ctx, {
    op: 'remove',
    sessionId: 's1',
    compactionId: 'card-1',
    text: 'removed checkpoint',
  })
  assert.equal(removed.ok, true)
  const afterRemove = await runOperation(ctx, { op: 'status', sessionId: 's1' })
  assert.equal(afterRemove.tailCount, 0)
  assert.equal(afterRemove.canRemove, false)
  const surfaceAfterRemove = session.surface.nodes
  assert.equal(surfaceAfterRemove.length, 2)
  assert.equal(surfaceAfterRemove[0], surfaceBefore[0])
  assert.notEqual(surfaceAfterRemove[1], tailSeq, 'the removed tail is gone from the surface')
  const removedCheckpoint = events
    .filter((event) => event.type === 'user/message' && event.data?.source?.kind === 'compact-checkpoint')
    .at(-1)
  assert.equal(removedCheckpoint.seq, surfaceAfterRemove[1])
  assert.equal(messageText(removedCheckpoint), 'removed checkpoint')
  assert.equal(events.some((event) => event.seq === tailSeq), true, 'the old event remains in the log only')

  // Removal is one-way; a later normal edit still works on the same card.
  const editedAfterRemove = await runOperation(ctx, {
    op: 'apply',
    sessionId: 's1',
    compactionId: 'card-1',
    text: 'edited after remove',
  })
  assert.equal(editedAfterRemove.ok, true)
  const afterRemoveEdit = await runOperation(ctx, { op: 'status', sessionId: 's1' })
  assert.equal(afterRemoveEdit.tailCount, 0)
  assert.equal(afterRemoveEdit.canRemove, false)
  const surfaceAfterRemoveEdit = session.surface.nodes
  assert.equal(surfaceAfterRemoveEdit.length, 2)
  assert.equal(surfaceAfterRemoveEdit[0], surfaceBefore[0])
  assert.notEqual(surfaceAfterRemoveEdit[1], tailSeq, 'later edit keeps the removed tail out')

  // The first real post-compaction user message closes editing.
  session.append('user/message', {
    source: { kind: 'user' },
    message: { id: 'msg-user', role: 'user', content: [] },
  })
  const started = await runOperation(ctx, { op: 'status', sessionId: 's1' })
  assert.equal(started.started, true)
  assert.equal(started.canRemove, false)
  const blocked = await runOperation(ctx, {
    op: 'apply',
    sessionId: 's1',
    compactionId: 'card-1',
    text: 'too late',
  })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'started')

  await assert.rejects(
    () => runOperation(ctx, { op: 'restore', sessionId: 's1', compactionId: 'card-1' }),
    (error) => error.code === 'bad-op',
    'restore is no longer an operation',
  )
})

test('acceptance: translation only reads session text and never mutates the log', async () => {
  const { ctx, events } = createFixture()
  ctx.agentDefaultModel = {
    currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-flash' }),
  }
  let request
  ctx.llm = {
    async resolveModelInfo() {
      return {
        name: 'DeepSeek Test',
        reasoning: {
          efforts: [
            { id: 'off', name: 'Off' },
            { id: 'high', name: 'High' },
          ],
        },
      }
    },
    async *stream(input) {
      request = input
      yield { type: 'text-delta', text: '翻译结果' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const before = events.length
  const result = await runOperation(ctx, {
    op: 'translate',
    sessionId: 's1',
    text: '原文',
  })
  assert.deepEqual(result, {
    ok: true,
    text: '翻译结果',
    model: 'DeepSeek Test',
    reasoningEffort: 'off',
    lowThinking: true,
  })
  assert.equal(events.length, before, 'translation does not append Session events')
  assert.equal(request.reasoningEffort, 'off', 'translation defaults to the low effort')
  assert.equal(request.messages.length, 1)
  assert.equal(request.messages[0].content[0].text, '原文')
})

test('acceptance: third-party model without a low effort uses default mode', async () => {
  const { ctx, events } = createFixture()
  ctx.agentDefaultModel = {
    currentSelection: () => ({ provider: 'third-party', model: 'fixed-thinking' }),
  }
  let request
  ctx.llm = {
    async resolveModelInfo() {
      return {
        name: 'Third Party Model',
        reasoning: { efforts: [{ id: 'high', name: 'High' }] },
      }
    },
    async *stream(input) {
      request = input
      yield { type: 'text-delta', text: '第三方译文' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const before = events.length
  const result = await runOperation(ctx, {
    op: 'translate',
    sessionId: 's1',
    text: 'source text',
  })
  assert.deepEqual(result, {
    ok: true,
    text: '第三方译文',
    model: 'Third Party Model',
    reasoningEffort: null,
    lowThinking: false,
  })
  assert.equal(request.reasoningEffort, undefined, 'do not force an unknown high effort')
  assert.equal(events.length, before)
})

test('acceptance: automatic compaction cards are read-only', async () => {
  const { ctx } = createFixture({ auto: true })
  const status = await runOperation(ctx, { op: 'status', sessionId: 's1' })
  assert.equal(status.ok, true)
  assert.equal(status.commandId, null)
  assert.equal(status.tailCount, 1)
  assert.equal(status.canRemove, false)

  for (const op of ['apply', 'remove']) {
    const result = await runOperation(ctx, {
      op,
      sessionId: 's1',
      compactionId: 'card-1',
      text: 'edited',
    })
    assert.equal(result.ok, false, op)
    assert.equal(result.code, 'auto', op)
  }
})

test('acceptance: operation body maps command actions and defaults the session', () => {
  assert.deepEqual(operationBody('{"action":"status"}', 's1'), {
    action: 'status',
    op: 'status',
    sessionId: 's1',
  })
  assert.equal(operationBody({ op: 'remove', sessionId: 's2' }, 's1').sessionId, 's2')
  assert.throws(() => operationBody('not json', 's1'), /JSON/)
  assert.throws(() => operationBody({}, 's1'), /action/)
})

test('acceptance: errors are explicit for missing sessions, changed cards and unknown messages', async () => {
  const { ctx } = createFixture()
  await assert.rejects(
    runOperation(ctx, { op: 'status', sessionId: 'missing' }),
    (error) => error.code === 'session-unavailable',
  )
  const changed = await runOperation(ctx, {
    op: 'apply',
    sessionId: 's1',
    compactionId: 'other-card',
    text: 'x',
  })
  assert.equal(changed.ok, false)
  assert.equal(changed.code, 'changed')
  const unknown = await runOperation(ctx, {
    op: 'messageSeq',
    sessionId: 's1',
    messageId: 'missing-message',
  })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'message-unavailable')
})
