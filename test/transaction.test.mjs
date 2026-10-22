import assert from 'node:assert/strict'
import test from 'node:test'

import { appendCompactionTransaction } from '../lib/compaction-transaction.js'

/**
 * Minimal Session stub that records appended events.
 * @returns recording session.
 */
function createSession() {
  const events = []
  let seq = 0
  return {
    events,
    append(type, data, opts) {
      const event = { type, seq: seq++, data, ...(opts ?? {}) }
      events.push(event)
      return event
    },
  }
}

/**
 * Minimal checkpoint message.
 * @returns user message.
 */
function checkpointMessage() {
  return {
    id: 'message-1',
    role: 'user',
    content: [{ type: 'text', text: 'checkpoint' }],
    source: { kind: 'compact-checkpoint', compactionId: 'c1' },
  }
}

test('compaction transaction appends the official event order', () => {
  const session = createSession()
  appendCompactionTransaction(session, {
    compactionId: 'c1',
    sourceCommandId: 'cmd1',
    summaryText: 'new summary',
    checkpointMessage: checkpointMessage(),
    shadowedSeqs: [5],
    shadowedRange: { start: 5, end: 5 },
    shadowedTokenCount: 10,
    provider: 'provider',
    model: 'model',
  })

  assert.deepEqual(
    session.events.map((event) => event.type),
    ['compaction/start', 'compaction/summary', 'user/message', 'compaction/end'],
  )
  assert.deepEqual(session.events[0].data, {
    compactionId: 'c1',
    sourceCommandId: 'cmd1',
    turn: null,
  })
  assert.deepEqual(session.events[1].data.summary, [{ type: 'text', text: 'new summary' }])
  assert.deepEqual(session.events[1].data.shadowedSeqs, [5])
  assert.deepEqual(session.events[2].surfaceOp, {
    op: 'replace',
    startSeq: 5,
    endSeq: 5,
  })
  assert.deepEqual(session.events[2].sourceEventSeqs, [0, 1, 5])
  assert.deepEqual(session.events[3].data, {
    compactionId: 'c1',
    sourceCommandId: 'cmd1',
    turn: null,
  })
})

test('compaction transaction closes a failed transaction with an error', () => {
  const events = []
  const session = {
    append(type, data, opts) {
      if (type === 'compaction/summary') throw new Error('boom')
      const event = { type, seq: events.length, data, ...(opts ?? {}) }
      events.push(event)
      return event
    },
  }

  assert.throws(
    () =>
      appendCompactionTransaction(session, {
        compactionId: 'c1',
        summaryText: 'new summary',
        checkpointMessage: checkpointMessage(),
        shadowedSeqs: [5],
        shadowedRange: { start: 5, end: 5 },
        shadowedTokenCount: 10,
        provider: 'provider',
        model: 'model',
      }),
    /boom/,
  )
  assert.deepEqual(
    events.map((event) => event.type),
    ['compaction/start', 'compaction/end'],
  )
  assert.equal(events[1].data.error, 'boom')
})
