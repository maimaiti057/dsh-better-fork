/**
 * dsh-better-fork — Host half.
 *
 * The plugin does not run compaction itself. Feature A automates the official
 * `/compact` command from the browser; this Host half only owns:
 *
 *   1. the `compactionEdit` Session projection that identifies the current
 *      compaction card, and
 *   2. a short status/apply route used by the editor.
 *
 * The normal apply appends one more valid compaction transaction using the
 * official `compaction/*` and `user/message` event types and replaces only the
 * current checkpoint, preserving the official compaction tail exactly like
 * editing the official card. The explicit Remove operation passes `wholeSpan`
 * to replace the checkpoint plus the whole tail; removal is one-way.
 */

import { randomUUID } from 'node:crypto'
import {
  COMPACTION_EDIT_KEY,
  applyCompactionEditEvent,
  computeReplaceSpan,
  createInitialCompactionEditState,
  hasOpenBoundary,
  isCheckpointEvent,
  reframeCheckpointContent,
  sumSpanTokens,
  textFromBlocks,
  viewOfCompactionEdit,
} from './lib/shared.js'
import { appendCompactionTransaction } from './lib/compaction-transaction.js'

export const name = 'dsh-better-fork'

export const inject = [
  'webServer',
  'sessionController',
  'tokenMeter',
  'sessions',
  'sessionProjections',
  'llm',
  'agentDefaultModel',
  'commands',
]

const API_PATH = '/dsh-better-fork/api'
const MAX_BODY_BYTES = 1024 * 1024
const MAX_TEXT_CHARS = 200_000
const TRANSLATE_SYSTEM =
  'You are a precise translator. Translate the user text into Simplified Chinese. Preserve Markdown, headings, lists, code blocks, links, tags, and proper nouns exactly. Translate only the supplied text; do not answer it, summarize it, or add commentary. Return only the translated text.'

/**
 * Install the compaction-edit projection, the editor API route, and the
 * translation route.
 * @param ctx - Host Cordis context.
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.sessionProjections.register({
        key: COMPACTION_EDIT_KEY,
        stateSchema: PASSTHROUGH_SCHEMA,
        stateVersion: 2,
        init: () => createInitialCompactionEditState(),
        apply: (state, event) => applyCompactionEditEvent(state, event),
        wire: {
          viewSchema: PASSTHROUGH_SCHEMA,
          view: (state) => viewOfCompactionEdit(state),
        },
      }),
    'better-fork: compaction edit projection',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: API_PATH,
        handler: (req, res) => {
          void handleRequest(ctx, req, res).catch((error) => {
            ctx.logger.warn(
              `better-fork: request failed: ${
                error instanceof Error ? error.stack ?? error.message : String(error)
              }`,
            )
            sendJson(res, 500, { ok: false, code: 'internal', message: 'internal error' })
          })
        },
      }),
    'better-fork: api route',
  )

  // One operation, two callers: the browser route above and this human command
  // both run the same `runOperation` method.
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'better-fork',
        description:
          'Inspect or edit the compacted context of the current Session. Input is a JSON operation body.',
        input: {
          hint: '{"action":"status|apply|remove|translate|messageSeq","sessionId":"...","compactionId":"...","text":"...","messageId":"..."}',
          attachments: false,
        },
        handler: async (invocation) => {
          try {
            const result = await runOperation(
              ctx,
              operationBody(invocation.rawInput, invocation.agent.id),
              invocation.signal,
            )
            if (result?.ok === false) {
              return { kind: 'error', text: `${result.code}: ${result.message}` }
            }
            return { kind: 'success', text: JSON.stringify(result) }
          } catch (error) {
            return {
              kind: 'error',
              text: error instanceof Error ? error.message : String(error),
            }
          }
        },
      }),
    'better-fork: command',
  )
}

/**
 * The registry only calls `.parse` on these schemas. The projection state and
 * view are produced and validated by this plugin, so a pass-through is exact.
 */
const PASSTHROUGH_SCHEMA = Object.freeze({ parse: (value) => value })

/**
 * Dispatch one short editor API request.
 * @param ctx - Host context.
 * @param req - Node HTTP request.
 * @param res - Node HTTP response.
 */
async function handleRequest(ctx, req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' })
    res.end()
    return
  }

  try {
    assertAllowedOrigin(ctx, req)
    assertJsonContentType(req)
    const body = await readJsonBody(req)
    const controller = new AbortController()
    const abort = () => controller.abort()
    req.once('aborted', abort)
    res.once('close', abort)
    try {
      sendJson(res, 200, await runOperation(ctx, body, controller.signal))
    } finally {
      req.off('aborted', abort)
      res.off('close', abort)
    }
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, {
        ok: false,
        code: error.code,
        message: error.message,
      })
      return
    }
    throw error
  }
}

/**
 * One Host service method shared by the browser route, the human command and
 * the human command. Every caller validates the same body and runs the same code.
 * @param ctx - Host context.
 * @param body - operation body (`op` plus operation fields).
 * @param signal - caller cancellation.
 * @returns operation payload.
 */
export async function runOperation(ctx, body, signal) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'bad-request', 'body must be an object')
  }
  const op = requireString(body.op, 'op')

  if (op === 'status') {
    const sessionId = requireString(body.sessionId, 'sessionId')
    const session = await resolveAgent(ctx, sessionId)
    return readStatus(ctx, session, optionalString(body.compactionId))
  }

  if (op === 'translate') {
    const sessionId = requireString(body.sessionId, 'sessionId')
    const text = requireString(body.text, 'text')
    if (text.length > MAX_TEXT_CHARS) {
      throw new HttpError(
        200,
        'too-large',
        `text exceeds the ${MAX_TEXT_CHARS.toLocaleString('en-US')}-character limit`,
      )
    }
    if (text.trim().length === 0) throw new HttpError(200, 'empty', 'text must not be empty')
    const session = await resolveAgent(ctx, sessionId)
    const cancel = signal ?? new AbortController().signal
    try {
      const translated = await translateText(ctx, session, text, cancel)
      return {
        ok: true,
        text: translated.text,
        model: translated.model,
        reasoningEffort: translated.reasoningEffort,
        lowThinking: translated.lowThinking,
      }
    } catch (error) {
      if (cancel.aborted) {
        return { ok: false, code: 'aborted', message: 'translation was cancelled' }
      }
      return {
        ok: false,
        code: 'translate-failed',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (op === 'remove') {
    const sessionId = requireString(body.sessionId, 'sessionId')
    const compactionId = requireString(body.compactionId, 'compactionId')
    const text = requireString(body.text, 'text')
    if (text.length > MAX_TEXT_CHARS) {
      throw new HttpError(
        200,
        'too-large',
        `text exceeds the ${MAX_TEXT_CHARS.toLocaleString('en-US')}-character limit`,
      )
    }
    if (text.trim().length === 0) throw new HttpError(200, 'empty', 'text must not be empty')
    const session = await resolveAgent(ctx, sessionId)
    return applyEdit(ctx, session, compactionId, text, true)
  }

  if (op === 'apply') {
    const sessionId = requireString(body.sessionId, 'sessionId')
    const compactionId = requireString(body.compactionId, 'compactionId')
    const text = requireString(body.text, 'text')
    if (text.length > MAX_TEXT_CHARS) {
      throw new HttpError(
        200,
        'too-large',
        `text exceeds the ${MAX_TEXT_CHARS.toLocaleString('en-US')}-character limit`,
      )
    }
    if (text.trim().length === 0) throw new HttpError(200, 'empty', 'text must not be empty')
    const session = await resolveAgent(ctx, sessionId)
    return applyEdit(ctx, session, compactionId, text, false)
  }

  if (op === 'messageSeq') {
    const sessionId = requireString(body.sessionId, 'sessionId')
    const messageId = requireString(body.messageId, 'messageId')
    const session = await resolveAgent(ctx, sessionId)
    for (const event of session.snapshotEvents(0, session.seq)) {
      if (
        (event.type === 'assistant/message' ||
          event.type === 'user/message' ||
          event.type === 'tool/result') &&
        event.data?.message?.id === messageId
      ) {
        return { ok: true, seq: event.seq }
      }
    }
    return {
      ok: false,
      code: 'message-unavailable',
      message: 'message seq is unavailable',
    }
  }

  throw new HttpError(400, 'bad-op', 'unknown op')
}

/**
 * Convert a human command JSON payload or an argument object into
 * the shared operation body. The current agent's Session is the default.
 * @param input - raw JSON string or argument object.
 * @param fallbackSessionId - current agent/session id.
 * @returns operation body.
 */
export function operationBody(input, fallbackSessionId) {
  let args = input
  if (typeof input === 'string') {
    try {
      args = JSON.parse(input)
    } catch {
      throw new HttpError(200, 'bad-json', 'command input must be a JSON object')
    }
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new HttpError(200, 'bad-request', 'operation input must be an object')
  }
  const op = requireString(args.action ?? args.op, 'action')
  const sessionId = optionalString(args.sessionId) ?? fallbackSessionId
  if (sessionId === undefined || sessionId.length === 0) {
    throw new HttpError(200, 'bad-session', 'sessionId is required')
  }
  return { ...args, op, sessionId }
}

/**
 * Read the current compaction card for the editor.
 * @param ctx - Host context.
 * @param session - target Session.
 * @param expectedCompactionId - optional card identity supplied by the client.
 * @returns status payload.
 */
function readStatus(ctx, session, expectedCompactionId) {
  const state = readProjectionState(ctx, session)
  if (
    state === undefined ||
    state.latestCompactionId === null ||
    state.latestCheckpointSeq === null
  ) {
    return { ok: false, code: 'none', message: 'no compaction card is available' }
  }
  if (
    expectedCompactionId !== undefined &&
    expectedCompactionId !== state.latestCompactionId
  ) {
    return {
      ok: false,
      code: 'changed',
      message: 'the current compaction card changed',
    }
  }

  const surface = session.surface.nodes
  const span = computeReplaceSpan(surface, state.latestCheckpointSeq)
  if (span === null) {
    return {
      ok: false,
      code: 'changed',
      message: 'the current compaction checkpoint is no longer on the surface',
    }
  }

  const checkpointEvent = readEvent(session, state.latestCheckpointSeq)
  if (
    checkpointEvent === undefined ||
    !isCheckpointEvent(checkpointEvent) ||
    checkpointEvent.data.source.compactionId !== state.latestCompactionId
  ) {
    return {
      ok: false,
      code: 'changed',
      message: 'the current compaction checkpoint is invalid',
    }
  }

  const summaryEvent = readEvent(session, state.latestSummarySeq)
  if (
    summaryEvent === undefined ||
    summaryEvent.type !== 'compaction/summary' ||
    summaryEvent.data.compactionId !== state.latestCompactionId
  ) {
    return {
      ok: false,
      code: 'changed',
      message: 'the current compaction summary is unavailable',
    }
  }

  let replaceTokens = 0
  try {
    replaceTokens = sumSpanTokens(ctx.tokenMeter.measure(session), [
      state.latestCheckpointSeq,
    ])
  } catch {
    replaceTokens = 0
  }

  const started = state.view?.started === true
  const tailCount = Math.max(0, span.length - 1)
  return {
    ok: true,
    summary: textFromBlocks(summaryEvent.data.summary),
    // A normal edit replaces only the compaction checkpoint; the official
    // compaction tail (including the last answer) stays in context.
    replaceCount: 1,
    replaceTokens,
    tailCount,
    spanCount: span.length,
    started,
    canRemove: state.latestCommandId !== null && tailCount > 0 && !started,
    compactionId: state.latestCompactionId,
    commandId: state.latestCommandId ?? null,
    busy: hasOpenBoundary(ownTail(session)),
  }
}

/**
 * Resolve the model that produced the session's current context.
 * @param ctx - Host context.
 * @param session - session whose compaction is being translated.
 * @returns provider/model, or null.
 */
function resolveTranslationModel(ctx, session) {
  let context
  try {
    context = session.requestContext()
  } catch {
    context = undefined
  }
  if (
    context !== undefined &&
    context !== null &&
    typeof context.provider === 'string' &&
    typeof context.model === 'string'
  ) {
    return { provider: context.provider, model: context.model }
  }
  let fallback
  try {
    fallback = ctx.agentDefaultModel?.currentSelection?.()
  } catch {
    fallback = undefined
  }
  if (
    fallback !== undefined &&
    fallback !== null &&
    typeof fallback.provider === 'string' &&
    typeof fallback.model === 'string'
  ) {
    return { provider: fallback.provider, model: fallback.model }
  }
  return null
}

/**
 * Pick the model's fastest declared reasoning effort for translation.
 * @param ctx - Host context.
 * @param model - resolved provider/model route.
 * @returns model display name and the effort id, or null when unsupported.
 */
async function resolveTranslationEffort(ctx, model) {
  if (typeof ctx.llm.resolveModelInfo !== 'function') {
    return { modelName: model.model, reasoningEffort: null }
  }
  try {
    const info = await ctx.llm.resolveModelInfo(model.provider, model.model)
    const efforts = info?.reasoning?.efforts ?? []
    const lowEffort =
      efforts.find((effort) =>
        /(off|none|disabled?|minimal|low|关闭|无|低)/i.test(
          `${effort.id} ${effort.name}`,
        ),
      )
    return {
      modelName: typeof info?.name === 'string' && info.name.length > 0 ? info.name : model.model,
      reasoningEffort: lowEffort?.id ?? null,
    }
  } catch {
    return { modelName: model.model, reasoningEffort: null }
  }
}

/**
 * Translate the compaction body with the session's original model. Only the
 * supplied text is sent; no transcript, tools, or session state participates.
 * @param ctx - Host context.
 * @param session - session supplying the model route.
 * @param text - compaction content to translate.
 * @param signal - request cancellation.
 * @returns translated text plus the model/effort actually used.
 */
async function translateText(ctx, session, text, signal) {
  const model = resolveTranslationModel(ctx, session)
  if (model === null) throw new Error('no model is available for translation')
  const target = await resolveTranslationEffort(ctx, model)
  let translated = ''
  let finish
  const stream = ctx.llm.stream({
    provider: model.provider,
    model: model.model,
    ...(target.reasoningEffort === null
      ? {}
      : { reasoningEffort: target.reasoningEffort }),
    system: TRANSLATE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    ],
    temperature: 0,
    signal,
  })
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') {
      translated += chunk.text
    } else if (
      chunk.type === 'block-end' &&
      translated === '' &&
      chunk.block !== undefined &&
      chunk.block.type === 'text'
    ) {
      translated = chunk.block.text
    } else if (chunk.type === 'finish') {
      finish = chunk
    }
  }
  if (finish !== undefined) {
    const kind = finish.reason?.kind
    if (kind === 'error') {
      throw new Error(finish.reason.failure?.message ?? 'translation failed')
    }
    if (kind === 'aborted') throw new Error('translation aborted')
    if (kind === 'max-tokens') throw new Error('translation was truncated')
  }
  const output = translated.trim()
  if (output.length === 0) throw new Error('the model returned an empty translation')
  return {
    text: output,
    model: target.modelName,
    reasoningEffort: target.reasoningEffort,
    lowThinking: target.reasoningEffort !== null,
  }
}

/**
 * Append the edited checkpoint transaction.
 * A normal edit replaces only the checkpoint, preserving the official
 * compaction tail. The explicit Remove operation passes `wholeSpan` to drop
 * the whole tail so the model context becomes only the compaction.
 * @param ctx - Host context.
 * @param session - target Session.
 * @param compactionId - current compaction identity supplied by the client.
 * @param text - edited summary body.
 * @param wholeSpan - replace the checkpoint and every surface node after it.
 * @returns apply payload.
 */
async function applyEdit(ctx, session, compactionId, text, wholeSpan = false) {
  const state = readProjectionState(ctx, session)
  if (
    state === undefined ||
    state.latestCompactionId === null ||
    state.latestCheckpointSeq === null
  ) {
    return { ok: false, code: 'none', message: 'no compaction card is available' }
  }
  if (state.latestCommandId === null) {
    return {
      ok: false,
      code: 'auto',
      message: 'automatic compaction cards are read-only',
    }
  }
  if (state.latestCompactionId !== compactionId) {
    return {
      ok: false,
      code: 'changed',
      message: 'the current compaction card changed',
    }
  }
  if (state.view?.started === true) {
    return {
      ok: false,
      code: 'started',
      message: 'the conversation has already started after this compaction',
    }
  }

  const surface = session.surface.nodes
  const span = computeReplaceSpan(surface, state.latestCheckpointSeq)
  if (span === null || span.length === 0) {
    return {
      ok: false,
      code: 'changed',
      message: 'the current compaction checkpoint is no longer on the surface',
    }
  }

  const replaceSeqs = wholeSpan ? span : [state.latestCheckpointSeq]

  const checkpointEvent = readEvent(session, state.latestCheckpointSeq)
  if (
    checkpointEvent === undefined ||
    !isCheckpointEvent(checkpointEvent) ||
    checkpointEvent.data.source.compactionId !== state.latestCompactionId
  ) {
    return {
      ok: false,
      code: 'changed',
      message: 'the current compaction checkpoint is invalid',
    }
  }

  const summaryEvent = readEvent(session, state.latestSummarySeq)
  if (
    summaryEvent === undefined ||
    summaryEvent.type !== 'compaction/summary' ||
    summaryEvent.data.compactionId !== state.latestCompactionId
  ) {
    return {
      ok: false,
      code: 'changed',
      message: 'the current compaction summary is unavailable',
    }
  }

  const currentText = textFromBlocks(summaryEvent.data.summary)
  if (!wholeSpan && text === currentText) return { ok: true, changed: false }

  if (hasOpenBoundary(ownTail(session))) {
    return {
      ok: false,
      code: 'busy',
      message: 'the session is running; try again after it becomes idle',
    }
  }

  const sourceCommandId = optionalString(state.latestCommandId)
  const provider = optionalString(summaryEvent.data.provider) ?? 'unknown'
  const model = optionalString(summaryEvent.data.model) ?? 'unknown'
  const startSeq = replaceSeqs[0]
  const endSeq = replaceSeqs[replaceSeqs.length - 1]

  let shadowedTokenCount = 0
  try {
    shadowedTokenCount = sumSpanTokens(ctx.tokenMeter.measure(session), replaceSeqs)
  } catch {
    shadowedTokenCount = 0
  }

  const checkpointMessage = {
    id: randomUUID(),
    role: 'user',
    content: reframeCheckpointContent(checkpointEvent.data.content, text),
    source: {
      kind: 'compact-checkpoint',
      compactionId: state.latestCompactionId,
      ...(sourceCommandId === undefined ? {} : { sourceCommandId }),
    },
  }

  appendCompactionTransaction(session, {
    compactionId: state.latestCompactionId,
    sourceCommandId,
    summaryText: text,
    checkpointMessage,
    shadowedSeqs: replaceSeqs,
    shadowedRange: { start: startSeq, end: endSeq },
    shadowedTokenCount,
    provider,
    model,
  })

  try {
    await ctx.sessions.flush(session)
  } catch (error) {
    return {
      ok: false,
      code: 'persistence',
      applied: true,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  return { ok: true, changed: true }
}

/**
 * Read the compaction-edit projection for one Session.
 * @param ctx - Host context.
 * @param session - target Session.
 * @returns projection state or undefined.
 */
function readProjectionState(ctx, session) {
  let projection
  try {
    projection = ctx.sessionProjections.stateOf(session, COMPACTION_EDIT_KEY)
  } catch (error) {
    ctx.logger.warn(
      `better-fork: projection read failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  if (
    projection !== undefined &&
    projection !== null &&
    projection.latestCompactionId !== null &&
    projection.latestCheckpointSeq !== null
  ) {
    return projection
  }

  // Fork children and sessions loaded after the projection was registered can
  // have an empty projection entry. Fold the committed transcript so the
  // inherited compaction card remains editable instead of reporting `none`.
  try {
    let state = createInitialCompactionEditState()
    for (const event of session.snapshotEvents(0, session.seq)) {
      state = applyCompactionEditEvent(state, event)
    }
    if (state.latestCompactionId !== null && state.latestCheckpointSeq !== null) {
      return state
    }
  } catch (error) {
    ctx.logger.warn(
      `better-fork: projection fallback failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  return projection ?? undefined
}

/**
 * Read one committed event by exact seq.
 * @param session - target Session.
 * @param seq - event seq, or null.
 * @returns the event or undefined.
 */
function readEvent(session, seq) {
  if (!Number.isSafeInteger(seq)) return undefined
  const events = session.snapshotEvents(seq, seq + 1)
  return events.length === 0 ? undefined : events[0]
}

/**
 * Committed events after the fork-inherited prefix.
 * @param session - target Session.
 * @returns own event tail.
 */
function ownTail(session) {
  return session.snapshotEvents(session.inheritedEventCount, session.seq)
}

/**
 * Resolve or resume one ordinary Session's Agent.
 * @param ctx - Host context.
 * @param sessionId - target Session.
 * @returns the Agent.
 */
async function resolveAgent(ctx, sessionId) {
  let resolved
  try {
    resolved = await ctx.sessionController.resolveAgent(sessionId)
  } catch (error) {
    throw new HttpError(
      200,
      'session-unavailable',
      error instanceof Error ? error.message : String(error),
    )
  }
  if (resolved?.error !== undefined) {
    throw new HttpError(
      200,
      'session-unavailable',
      resolved.error instanceof Error ? resolved.error.message : String(resolved.error),
    )
  }
  const agent = resolved?.agent
  if (agent === undefined || typeof agent.id !== 'string') {
    throw new HttpError(200, 'session-unavailable', 'session agent is unavailable')
  }
  const session = ctx.sessions.get(agent.id)
  if (session === undefined) {
    throw new HttpError(200, 'session-unavailable', 'session is not attached')
  }
  return session
}

/**
 * Enforce a loopback/same-host browser request. A missing Origin is treated as
 * a same-origin/older-carrier request; a present but different Origin is
 * refused. Both `localhost` and `127.0.0.1` spellings of the same local port
 * are accepted, so a page opened under either name can use the editor.
 * @param ctx - Host context.
 * @param req - HTTP request.
 */
function assertAllowedOrigin(ctx, req) {
  const origin = headerValue(req.headers.origin)
  if (origin === undefined) return
  let expected
  try {
    expected = new URL(ctx.webServer.getOrigin())
  } catch {
    return
  }
  let actual
  try {
    actual = new URL(origin)
  } catch {
    throw new HttpError(403, 'forbidden', 'origin not allowed')
  }
  const loopback = (hostname) =>
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '0:0:0:0:0:0:0:1'
  const sameProtocol = actual.protocol === expected.protocol
  const samePort = actual.port === expected.port
  const sameHost = actual.hostname === expected.hostname
  const bothLoopback = loopback(actual.hostname) && loopback(expected.hostname)
  if (!sameProtocol || !samePort || !(sameHost || bothLoopback)) {
    throw new HttpError(403, 'forbidden', 'origin not allowed')
  }
}

/**
 * Require a JSON content type. A cross-origin form cannot set this header
 * without a preflight, so it complements the Origin check.
 * @param req - HTTP request.
 */
function assertJsonContentType(req) {
  const contentType = headerValue(req.headers['content-type'])
  if (contentType === undefined || !contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported-media-type', 'content-type must be application/json')
  }
}

/**
 * Read and parse a bounded JSON object body.
 * @param req - HTTP request.
 * @returns parsed object.
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'body-too-large', 'request body is too large')
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw === '') throw new HttpError(400, 'bad-json', 'request body must be a JSON object')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'bad-json', 'request body must be valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'bad-json', 'request body must be a JSON object')
  }
  return parsed
}

/**
 * Accept the first value of a possibly repeated Node header.
 * @param value - header value.
 * @returns string or undefined.
 */
function headerValue(value) {
  if (Array.isArray(value)) return value.length > 0 ? value[0] : undefined
  return typeof value === 'string' ? value : undefined
}

/**
 * Require a non-empty string field.
 * @param value - candidate.
 * @param field - field name for diagnostics.
 * @returns the string.
 */
function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, 'bad-request', `${field} must be a non-empty string`)
  }
  return value
}

/**
 * Normalize an optional non-empty string.
 * @param value - candidate.
 * @returns string or undefined.
 */
function optionalString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Send one JSON response unless the carrier already closed it.
 * @param res - HTTP response.
 * @param status - HTTP status.
 * @param value - JSON-serializable payload.
 */
function sendJson(res, status, value) {
  if (res.writableEnded || res.destroyed) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

/** Classified request/domain failure with an HTTP status and stable code. */
class HttpError extends Error {
  /**
   * @param status - HTTP status to send.
   * @param code - stable client-facing code.
   * @param message - diagnostic message.
   */
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}
