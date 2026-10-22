/**
 * Pure helpers shared by the host plugin, the browser module, and tests.
 *
 * Nothing in this file imports Cordis, Node built-ins, or browser globals.
 * The host reads the compaction-edit projection through these functions, and
 * the unit tests exercise the same code paths without a live Session.
 */

export const COMPACTION_EDIT_KEY = 'compactionEdit'
export const SUMMARY_OPEN_TAG = '<compacted-summary>'
export const SUMMARY_CLOSE_TAG = '</compacted-summary>'

/** Stable initial wire view. */
const IDLE_VIEW = Object.freeze({
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

/**
 * Create the initial per-session state for the compaction-edit projection.
 * @returns a JSON-serializable projection state.
 */
export function createInitialCompactionEditState() {
  return {
    activeCompactionId: null,
    activeCommandId: null,
    activeSummarySeq: null,
    activeCheckpointSeq: null,
    latestCompactionId: null,
    latestCommandId: null,
    latestSummarySeq: null,
    latestCheckpointSeq: null,
    latestSummaryText: null,
    latestSummaryTokens: 0,
    surfaceTailSeqs: [],
    view: IDLE_VIEW,
  }
}

/**
 * Read the client-visible view from a projection state.
 * @param state - current projection state.
 * @returns `{ compactionId, checkpointSeq, started }`.
 */
export function viewOfCompactionEdit(state) {
  return state.view
}

/**
 * Recompute the wire view from the projection state. Returns the same view
 * object when every field is unchanged, so publication is suppressed.
 * @param state - projection state.
 * @returns stable view.
 */
function refreshView(state) {
  const tailCount = state.surfaceTailSeqs?.length ?? 0
  const started = state.view.started === true
  const hasCard = state.latestCheckpointSeq !== null
  const next = {
    compactionId: state.view.compactionId,
    checkpointSeq: state.view.checkpointSeq,
    started,
    commandId: state.latestCommandId ?? null,
    summary: state.latestSummaryText ?? null,
    replaceCount: hasCard ? 1 : 0,
    replaceTokens: state.latestSummaryTokens ?? 0,
    tailCount: hasCard ? tailCount : 0,
    spanCount: hasCard ? tailCount + 1 : 0,
    canRemove: hasCard && tailCount > 0 && !started,
  }
  const current = state.view
  if (
    current.compactionId === next.compactionId &&
    current.checkpointSeq === next.checkpointSeq &&
    current.started === next.started &&
    current.commandId === next.commandId &&
    current.summary === next.summary &&
    current.replaceCount === next.replaceCount &&
    current.replaceTokens === next.replaceTokens &&
    current.tailCount === next.tailCount &&
    current.spanCount === next.spanCount &&
    current.canRemove === next.canRemove
  ) {
    return current
  }
  return next
}

/**
 * Fold one committed Session event into the compaction-edit state.
 *
 * The projection tracks the latest successful compaction transaction,
 * regardless of fork/root, manual/automatic, or later conversation turns.
 * It also keeps the active transaction while it is being assembled.
 *
 * @param state - current projection state.
 * @param event - committed Session event.
 * @returns the same state for irrelevant events, otherwise a new state.
 */
export function applyCompactionEditEvent(state, event) {
  if (event === null || typeof event !== 'object') return state

  if (event.type === 'compaction/start') {
    const data = event.data ?? {}
    const compactionId = data.compactionId
    if (typeof compactionId !== 'string' || compactionId.length === 0) return state
    const commandId = nonEmptyString(data.sourceCommandId)
    if (
      state.activeCompactionId === compactionId &&
      state.activeCommandId === commandId &&
      state.activeSummarySeq === null &&
      state.activeCheckpointSeq === null
    ) {
      return state
    }
    const next = {
      ...state,
      activeCompactionId: compactionId,
      activeCommandId: commandId,
      activeSummarySeq: null,
      activeCheckpointSeq: null,
    }
    return next
  }

  if (event.type === 'compaction/summary') {
    const data = event.data ?? {}
    if (data.compactionId !== state.activeCompactionId) return state
    if (state.activeSummarySeq === event.seq) return state
    const next = {
      ...state,
      activeSummarySeq: event.seq,
      latestSummaryText: textFromBlocks(data.summary),
      latestSummaryTokens:
        typeof data.shadowedTokenCount === 'number' ? data.shadowedTokenCount : 0,
    }
    return next
  }

  if (isCheckpointEvent(event)) {
    const source = event.data.source
    if (source.compactionId !== state.activeCompactionId) return state
    if (state.activeCheckpointSeq === event.seq) return state
    const commandId = nonEmptyString(source.sourceCommandId) ?? state.activeCommandId
    const surfaceOp = event.surfaceOp
    const replacesOnlyCheckpoint =
      typeof surfaceOp === 'object' &&
      surfaceOp !== null &&
      surfaceOp.op === 'replace' &&
      surfaceOp.startSeq === surfaceOp.endSeq
    return {
      ...state,
      activeCheckpointSeq: event.seq,
      activeCommandId: commandId ?? null,
      // A normal edit replaces only the checkpoint; the official tail stays.
      // Remove and a new compaction replace the whole span, so reset the tail.
      surfaceTailSeqs: replacesOnlyCheckpoint ? (state.surfaceTailSeqs ?? []) : [],
    }
  }

  if (event.type === 'compaction/end') {
    const data = event.data ?? {}
    if (data.compactionId !== state.activeCompactionId) return state

    if (data.error !== undefined) {
      return clearActive(state)
    }

    if (state.activeCheckpointSeq === null || state.activeSummarySeq === null) {
      return clearActive(state)
    }

    const compactionId = state.activeCompactionId
    const checkpointSeq = state.activeCheckpointSeq
    const started =
      state.view.compactionId === compactionId ? state.view.started === true : false
    const next = {
      ...state,
      activeCompactionId: null,
      activeCommandId: null,
      activeSummarySeq: null,
      activeCheckpointSeq: null,
      latestCompactionId: compactionId,
      latestCommandId: state.activeCommandId ?? null,
      latestSummarySeq: state.activeSummarySeq,
      latestCheckpointSeq: checkpointSeq,
      view: { ...state.view, compactionId, checkpointSeq, started },
    }
    return { ...next, view: refreshView(next) }
  }

  if (
    event.type === 'user/message' &&
    event.data?.source?.kind === 'user' &&
    state.activeCompactionId === null &&
    state.latestCompactionId !== null
  ) {
    const tail = state.surfaceTailSeqs ?? []
    const next = {
      ...state,
      surfaceTailSeqs: tail.includes(event.seq) ? tail : [...tail, event.seq],
      view: { ...state.view, started: true },
    }
    return { ...next, view: refreshView(next) }
  }

  if (
    state.latestCompactionId !== null &&
    isSurfaceEvent(event) &&
    !isCheckpointEvent(event)
  ) {
    const tail = state.surfaceTailSeqs ?? []
    if (!tail.includes(event.seq)) {
      const next = { ...state, surfaceTailSeqs: [...tail, event.seq] }
      // Active compaction transactions are not published until they end.
      return state.activeCompactionId === null ? { ...next, view: refreshView(next) } : next
    }
  }

  return state
}

/**
 * Clear the active transaction while keeping the latest successful one.
 * @param state - current projection state.
 * @returns a new state with active fields cleared.
 */
function clearActive(state) {
  if (
    state.activeCompactionId === null &&
    state.activeCommandId === null &&
    state.activeSummarySeq === null &&
    state.activeCheckpointSeq === null
  ) {
    return state
  }
  const next = {
    ...state,
    activeCompactionId: null,
    activeCommandId: null,
    activeSummarySeq: null,
    activeCheckpointSeq: null,
  }
  return { ...next, view: refreshView(next) }
}

/**
 * Join text blocks the same way the official compaction card joins its summary.
 * @param blocks - ContentBlock array.
 * @returns concatenated text.
 */
export function textFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return ''
  let text = ''
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string') text += block.text
  }
  return text
}

/**
 * Read the summary body between the durable checkpoint tags.
 * @param content - checkpoint message content blocks.
 * @returns the text between the tags, or the whole text when tags are absent.
 */
export function extractSummaryText(content) {
  const full = textFromBlocks(content)
  const open = full.indexOf(SUMMARY_OPEN_TAG)
  const close = full.lastIndexOf(SUMMARY_CLOSE_TAG)
  if (open >= 0 && close > open) {
    return full.slice(open + SUMMARY_OPEN_TAG.length, close)
  }
  return full
}

/**
 * Re-frame an edited summary inside the existing checkpoint preamble and tags.
 *
 * The original preamble and the opening/closing tags are kept verbatim; only
 * the editable middle is replaced. When the tags are absent the edited text is
 * used as-is so the model still receives the user's content.
 *
 * @param content - current checkpoint message content blocks.
 * @param editedText - replacement summary body.
 * @returns new ContentBlock[] for the replacement user message.
 */
export function reframeCheckpointContent(content, editedText) {
  const full = textFromBlocks(content)
  const open = full.indexOf(SUMMARY_OPEN_TAG)
  const close = full.lastIndexOf(SUMMARY_CLOSE_TAG)
  if (open < 0 || close <= open) {
    return [{ type: 'text', text: editedText }]
  }
  const prefix = full.slice(0, open + SUMMARY_OPEN_TAG.length)
  const suffix = full.slice(close)
  const blocks = []
  if (prefix.length > 0) blocks.push({ type: 'text', text: prefix })
  blocks.push({ type: 'text', text: editedText })
  if (suffix.length > 0) blocks.push({ type: 'text', text: suffix })
  return blocks
}

/**
 * Test whether an event is a compaction checkpoint replacement message.
 * @param event - Session event.
 * @returns true for a replacement user message carrying a compact checkpoint.
 */
export function isCheckpointEvent(event) {
  if (event === null || typeof event !== 'object' || event.type !== 'user/message') return false
  const surfaceOp = event.surfaceOp
  if (surfaceOp === undefined || surfaceOp === 'append') return false
  if (typeof surfaceOp !== 'object' || surfaceOp === null) return false
  const source = event.data?.source
  return source?.kind === 'compact-checkpoint' && nonEmptyString(source.compactionId) !== undefined
}

/**
 * Test whether an event contributes a model-visible surface node.
 * @param event - Session event.
 * @returns true for the surface event kinds tracked after a checkpoint.
 */
export function isSurfaceEvent(event) {
  return (
    event.type === 'assistant/message' ||
    event.type === 'tool/result' ||
    event.type === 'user/message' ||
    event.type === 'system/message' ||
    event.type === 'developer/message'
  )
}

/**
 * Select the current surface span that starts at the current compaction
 * checkpoint and runs through the end of the model-visible surface.
 *
 * Replacing this whole span with the edited checkpoint makes the edited text
 * the complete non-system context, as required.
 *
 * @param surface - current surface seq array.
 * @param checkpointSeq - the latest compaction checkpoint seq.
 * @returns the inclusive span, or null when the checkpoint is absent.
 */
export function computeReplaceSpan(surface, checkpointSeq) {
  if (!Array.isArray(surface)) return null
  const index = surface.indexOf(checkpointSeq)
  if (index < 0) return null
  return surface.slice(index)
}

/**
 * Sum heuristic tokens for a surface span.
 * @param measurement - `ctx.tokenMeter.measure(session)` result.
 * @param spanSeqs - surface seqs in the span.
 * @returns non-negative integer token estimate.
 */
export function sumSpanTokens(measurement, spanSeqs) {
  if (!Array.isArray(spanSeqs) || spanSeqs.length === 0) return 0
  const bySeq = new Map()
  const nodes = Array.isArray(measurement?.nodes) ? measurement.nodes : []
  for (const node of nodes) {
    if (node && Number.isSafeInteger(node.seq)) bySeq.set(node.seq, node)
  }
  let total = 0
  for (const seq of spanSeqs) {
    const node = bySeq.get(seq)
    const value = node?.heuristicTokens ?? node?.tokens ?? 0
    if (Number.isFinite(value) && value > 0) total += value
  }
  return Math.max(0, Math.trunc(total))
}

/**
 * Detect an open turn or an open compaction bracket in a committed event tail.
 *
 * A newer `session/end-seed` makes an older compaction start stale, matching
 * the compaction lock's own recovery rule.
 *
 * @param events - committed Session events.
 * @returns true when a standalone compaction transaction would be rejected.
 */
export function hasOpenBoundary(events) {
  let turnOpen = false
  let compactionOpen = false
  for (const event of events) {
    switch (event?.type) {
      case 'turn/start':
        turnOpen = true
        break
      case 'turn/end':
        turnOpen = false
        break
      case 'compaction/start':
        compactionOpen = true
        break
      case 'compaction/end':
        compactionOpen = false
        break
      case 'session/end-seed':
        compactionOpen = false
        break
      default:
        break
    }
  }
  return turnOpen || compactionOpen
}

/**
 * Normalize an optional non-empty string.
 * @param value - candidate.
 * @returns the string or undefined.
 */
function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
