/**
 * Low-level compaction transaction writer.
 *
 * Official DSH has no "edit compaction" service, so the plugin reproduces the
 * same committed event sequence the official compaction writes. Keeping every
 * `session.append` call in one place makes that compatibility surface explicit:
 * if the event payloads or order change, this is the only host file to update.
 */

/**
 * Append one complete compaction transaction.
 *
 * The caller owns validation, checkpoint text/content, and the final flush.
 *
 * @param session - live Session.
 * @param input - transaction fields.
 */
export function appendCompactionTransaction(session, input) {
  const {
    compactionId,
    sourceCommandId,
    summaryText,
    checkpointMessage,
    shadowedSeqs,
    shadowedRange,
    shadowedTokenCount,
    provider,
    model,
  } = input
  const source = sourceCommandId === undefined ? {} : { sourceCommandId }
  let started = false

  try {
    const startEvent = session.append('compaction/start', {
      compactionId,
      ...source,
      turn: null,
    })
    started = true

    const summaryEvent = session.append('compaction/summary', {
      compactionId,
      ...source,
      summary: [{ type: 'text', text: summaryText }],
      shadowedRange,
      shadowedSeqs: [...shadowedSeqs],
      shadowedTokenCount,
      provider,
      model,
    })

    session.append('user/message', checkpointMessage, {
      surfaceOp: {
        op: 'replace',
        startSeq: shadowedRange.start,
        endSeq: shadowedRange.end,
      },
      sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs],
    })

    session.append('compaction/end', {
      compactionId,
      ...source,
      turn: null,
    })
  } catch (error) {
    if (started) {
      try {
        session.append('compaction/end', {
          compactionId,
          ...source,
          turn: null,
          error: error instanceof Error ? error.message : String(error),
        })
      } catch {
        // Best-effort close; the original failure is the useful one.
      }
    }
    throw error
  }
}
