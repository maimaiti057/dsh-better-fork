import assert from 'node:assert/strict'
import test from 'node:test'

// The client module is a browser Module-Loader script. Install the minimal
// browser surface it touches before importing it.
let loaded
globalThis.window = { __ModuleLoader__: { load(definition) { loaded = definition } } }
globalThis.document = {
  activeElement: null,
  head: { appendChild() {} },
  createElement() {
    return { dataset: {}, textContent: '', remove() {} }
  },
}
globalThis.fetch = async () => {
  throw new Error('fetch stub was not configured')
}

const react = {
  createElement: (...args) => ({ args }),
  Fragment: Symbol('Fragment'),
  useEffect() {},
  useRef() {},
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
}

const primitives = {
  IconBranchOutlineRegular: function IconBranchOutlineRegular() {
    return { icon: 'branch' }
  },
  MenuItemButton: function MenuItemButton(props) {
    return { menuItem: props }
  },
}

await import('../lib/client.js')
assert.ok(loaded, 'client module registered with the loader')
assert.equal(loaded.id, 'dsh-better-fork')

const client = loaded.factory((name) => {
  if (name === 'react') return react
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected module ${name}`)
})

/**
 * Capture the store and registered slot/Definition faces from a mock apply.
 * @returns test harness.
 */
function boot() {
  const slots = []
  const definitions = []
  const disposers = []
  const locales = {}
  const ctx = {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    locale: {
      register(_namespace, dictionaries) {
        Object.assign(locales, dictionaries)
        return () => {}
      },
      getSnapshot() {
        return { active: 'zh', locales: [], revision: 0 }
      },
      subscribe() {
        return () => {}
      },
    },
    slots: {
      inject(_name, callback) {
        return callback()
      },
      register(options, component) {
        slots.push({ options, component })
        return () => {}
      },
    },
    uiConversation: {
      events: {
        register(definition) {
          definitions.push(definition)
          return () => {}
        },
      },
    },
    sessions: {
      async fork() {
        return 'child-session'
      },
    },
    uiWorkspace: {
      forkSession: async () => 'child-session',
      openSession() {},
    },
    remote: {
      commands: {
        execute() {
          return Promise.resolve({
            ok: true,
            value: { commandId: 'command-1', result: { kind: 'success' } },
          })
        },
      },
    },
  }
  client.apply(ctx)
  const overlay = slots.find((item) => item.options.id === 'compaction-edit-dialog')
  assert.ok(overlay, 'overlay registered')
  const store = overlay.options.inject().store
  assert.ok(store, 'store exposed through the overlay inject face')
  const editNode = slots.find((item) => item.options.key === 'compaction-edit-action')
  const menu = slots.find((item) => item.options.name === 'sidebar.workspaces.session.menu.item')
  assert.ok(editNode, 'edit node registered')
  assert.ok(menu, 'session menu action registered')
  return {
    ctx,
    slots,
    definitions,
    disposers,
    store,
    locales,
    branchAtCard: editNode.options.inject().branchAtCard,
  }
}

/**
 * Build a fetch Response-like object.
 * @param payload - JSON payload.
 * @param status - HTTP status.
 * @returns response stub.
 */
function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (payload === undefined ? '' : JSON.stringify(payload)),
  }
}

/**
 * Build one editing status payload with tail/can-edit facts.
 * @param overrides - fields to override.
 * @returns status payload.
 */
function statusPayload(overrides = {}) {
  return {
    ok: true,
    summary: 'compacted summary',
    replaceCount: 1,
    replaceTokens: 10,
    tailCount: 1,
    spanCount: 2,
    started: false,
    canRemove: true,
    compactionId: 'c1',
    commandId: 'cmd1',
    busy: false,
    ...overrides,
  }
}

/**
 * Wait briefly for the branch watcher's 750ms poll.
 * @returns promise.
 */
function waitForWatcher() {
  return new Promise((resolve) => setTimeout(resolve, 900))
}

test('client contracts: slots, definitions and inject faces', () => {
  const harness = boot()
  const names = harness.slots.map((item) => item.options.name)
  assert.deepEqual(names, [
    'sidebar.workspaces.session.menu.item',
    'conversation.chat.node',
    'conversation.chat.assistant-actions',
    'shell.overlay',
  ])
  assert.equal(harness.slots[0].options.id, 'better-fork')
  assert.equal(harness.slots[0].options.order, 500)
  assert.equal(harness.slots[1].options.key, 'compaction-edit-action')
  assert.equal(harness.slots[2].options.id, 'better-fork-start')
  assert.equal(harness.slots[2].options.order, 1000)
  assert.equal(harness.slots[3].options.id, 'compaction-edit-dialog')
  assert.equal(harness.definitions.length, 1)
  assert.deepEqual(
    harness.definitions.map((item) => item.kind),
    ['compaction-edit-action'],
  )
})

test('client dictionaries are complete in English and Chinese', () => {
  const { en, zh } = boot().locales
  assert.ok(en, 'English dictionary registered')
  assert.ok(zh, 'Chinese dictionary registered')
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'same key set')

  const placeholders = (value) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

  for (const key of Object.keys(en)) {
    assert.ok(en[key].trim(), `en.${key} is not empty`)
    assert.ok(zh[key].trim(), `zh.${key} is not empty`)
    assert.doesNotMatch(
      en[key],
      /\p{Script=Han}/u,
      `en.${key} has no untranslated Chinese`,
    )
    assert.deepEqual(
      placeholders(en[key]),
      placeholders(zh[key]),
      `placeholders match for ${key}`,
    )
  }
})

test('start-here entries use the hollow frameless play mark and the requested wording', () => {
  const harness = boot()
  assert.equal(harness.locales.zh['betterBranch.menu.label'], '从这里开始')
  assert.equal(harness.locales.zh['cardBranch.label'], '分叉')
  assert.equal(harness.locales.zh['betterBranch.node.title'], '从这里开启新的会话')
  assert.equal(harness.locales.zh['cardBranch.title'], '从这张压缩卡片的最新位置分叉。')
  assert.match(harness.locales.zh['dialog.stats'], /官方压缩默认保留最后一个对话节点/)
  assert.match(harness.locales.zh['dialog.warning'], /移除最后一个对话节点/)
  assert.match(harness.locales.zh['dialog.statsEmpty'], /没有保留节点/)
  assert.match(harness.locales.zh['dialog.warningEmpty'], /没有可移除的上下文节点/)

  const t = (key) => harness.locales.zh[key]
  const menuSlot = harness.slots.find(
    (item) => item.options.name === 'sidebar.workspaces.session.menu.item',
  )
  const menuTree = menuSlot.component({
    sessionId: 'session-1',
    useMenuOpenState: () => [false, () => {}],
    useSessionAccess: () => true,
    startForkAndCompact() {},
    t,
  })
  const menuItem = menuTree.args.find(
    (child) => child?.args?.[1]?.children === '从这里开始',
  )
  assert.ok(menuItem, 'menu row uses the new label')
  assert.equal(menuItem.args[1].icon.args[0], 'svg')
  assert.equal(menuItem.args[1].icon.args[1].viewBox, '0 0 16 16')
  assert.equal(menuItem.args[1].icon.args[1].strokeWidth, 1)
  assert.equal(menuItem.args[1].icon.args[1].strokeLinejoin, 'round')
  assert.equal(menuItem.args[1].icon.args.length, 3, 'single hollow play path')
  assert.equal(menuItem.args[1].icon.args[2].args[1].fill, 'none')
  assert.equal(menuItem.args[1].icon.args[2].args[1].stroke, 'currentColor')

  const assistantSlot = harness.slots.find(
    (item) => item.options.id === 'better-fork-start',
  )
  const assistantTree = assistantSlot.component({
    messageId: 'message-1',
    sessionId: 'session-1',
    useSessionAccess: () => true,
    startForkAtMessage() {},
    t,
  })
  const button = assistantTree.args.find((child) => child?.args?.[0] === 'button')
  assert.ok(button, 'assistant action button is rendered')
  assert.equal(button.args[1].title, '从这里开启新的会话')
  assert.equal(button.args[1]['aria-label'], '从这里开启新的会话')
  const icon = button.args[2]
  assert.equal(icon.args[0], 'svg')
  assert.equal(icon.args[1].viewBox, '0 0 16 16')
  assert.equal(icon.args[1].strokeWidth, 1)
  assert.equal(icon.args[1].strokeLinejoin, 'round')
  assert.equal(icon.args.length, 3, 'single hollow play path')
  assert.equal(icon.args[2].args[1].fill, 'none')
  assert.equal(icon.args[2].args[1].stroke, 'currentColor')
})

test('compaction card keeps the official branch action and icon', () => {
  const harness = boot()
  const cardSlot = harness.slots.find(
    (item) => item.options.key === 'compaction-edit-action',
  )
  const store = {
    subscribe() {
      return () => {}
    },
    getSnapshot() {
      return { phase: 'idle', sessionId: null, compactionId: null }
    },
  }
  const branches = []
  const tree = cardSlot.component({
    node: { data: { compactionId: 'c1' }, anchorSeq: 10 },
    sessionId: 'session-1',
    useProjection: () => ({ compactionId: 'c1', commandId: 'cmd1', started: false }),
    useSessionAccess: () => true,
    openEditor() {},
    branchAtCard(sessionId, seq) {
      branches.push([sessionId, seq])
    },
    store,
    t: (key) => harness.locales.zh[key],
  })
  const button = tree.args.find(
    (child) =>
      child?.args?.[0] === 'button' &&
      child.args[1]?.className === 'dsh-bf-cardAction',
  )
  assert.ok(button, 'card branch button is rendered')
  assert.equal(button.args[1].title, '从这张压缩卡片的最新位置分叉。')
  assert.equal(button.args[3].args[2], '分叉')
  const icon = button.args[2]
  assert.equal(icon.args[0], 'svg')
  assert.equal(icon.args[1].viewBox, '0 0 16 16')
  assert.equal(icon.args[1].strokeWidth, 1)
  assert.equal(icon.args.length, 6, 'two paths and two endpoint circles')
  button.args[1].onClick({ preventDefault() {}, stopPropagation() {} })
  assert.deepEqual(branches, [['session-1', 10]])
})

test('compaction card hides its branch without fork access but keeps edit', () => {
  const harness = boot()
  const cardSlot = harness.slots.find(
    (item) => item.options.key === 'compaction-edit-action',
  )
  const store = {
    subscribe() {
      return () => {}
    },
    getSnapshot() {
      return { phase: 'idle', sessionId: null, compactionId: null }
    },
  }
  const tree = cardSlot.component({
    node: { data: { compactionId: 'c1' }, anchorSeq: 10 },
    sessionId: 'session-1',
    useProjection: () => ({ compactionId: 'c1', commandId: 'cmd1', started: false }),
    useSessionAccess: () => false,
    openEditor() {},
    branchAtCard() {},
    store,
    t: (key) => harness.locales.zh[key],
  })
  const buttons = tree.args.filter(
    (child) =>
      child?.args?.[0] === 'button' &&
      child.args[1]?.className === 'dsh-bf-cardAction',
  )
  assert.equal(buttons.length, 1, 'branch is hidden when fork is not allowed')
  assert.equal(buttons[0].args[1].title, '编辑上下文')
})

test('automatic compaction cards add no plugin actions at all', () => {
  const harness = boot()
  const cardSlot = harness.slots.find(
    (item) => item.options.key === 'compaction-edit-action',
  )
  const store = {
    subscribe() {
      return () => {}
    },
    getSnapshot() {
      return { phase: 'idle', sessionId: null, compactionId: null }
    },
  }
  const tree = cardSlot.component({
    node: { data: { compactionId: 'auto-1' }, anchorSeq: 10 },
    sessionId: 'session-1',
    useProjection: () => ({ compactionId: 'auto-1', commandId: null, started: false }),
    useSessionAccess: () => true,
    openEditor() {},
    branchAtCard() {
      assert.fail('automatic cards must not expose branch')
    },
    store,
    t: (key) => harness.locales.zh[key],
  })
  assert.equal(tree, null, 'no branch, edit, or remove action row')
})

test('client Definition folds every successful compaction end', () => {
  const harness = boot()
  const definition = harness.definitions[0]
  const match = definition.match({
    type: 'compaction/end',
    seq: 10,
    time: 100,
    data: { compactionId: 'c1' },
  })
  assert.deepEqual(match, { id: 'c1', role: 'start' })
  assert.equal(
    definition.match({
      type: 'compaction/end',
      seq: 11,
      time: 101,
      data: { compactionId: 'c1', error: 'failed' },
    }),
    null,
  )
  const context = {
    key: 'compaction:c1',
    id: 'c1',
    start: { location: { kind: 'session' } },
    matches: [{ location: { kind: 'session' } }],
  }
  const state = definition.start(context, { event: { seq: 10, time: 100, data: { compactionId: 'c1' } } })
  const node = definition.buildViewNode({ ...context, state })
  assert.equal(node.kind, 'compaction-edit-action')
  assert.equal(node.anchorSeq, 10)
  assert.deepEqual(node.data, { compactionId: 'c1' })
  const updated = definition.update({ state }, { event: { seq: 12, time: 102 } })
  assert.equal(updated.endSeq, 12)
})

test('feature A forks, switches and invokes the official /compact command', async () => {
  const harness = boot()
  globalThis.fetch = async () =>
    response({ ok: false, code: 'none', message: 'no compaction card is available' })
  const calls = []
  harness.ctx.uiWorkspace.forkSession = async (sourceId, onCreated, options) => {
    calls.push(['fork', sourceId, options])
    return 'child-session'
  }
  harness.ctx.uiWorkspace.openSession = (sessionId) => {
    calls.push(['open', sessionId])
  }
  harness.ctx.remote.commands.execute = (sessionId, line, attachments) => {
    calls.push(['execute', sessionId, line, attachments])
    return Promise.resolve({
      ok: true,
      value: { commandId: 'command-1', result: { kind: 'success' } },
    })
  }

  await harness.store.startForkAndCompact('source-session')
  await Promise.resolve()
  await Promise.resolve()

  assert.deepEqual(calls[0], ['fork', 'source-session', { allowMigration: false }])
  assert.deepEqual(calls[1], ['open', 'child-session'])
  assert.deepEqual(calls[2], ['execute', 'child-session', '/compact', []])
  assert.equal(harness.store.getSnapshot().phase, 'idle')
  harness.store.dispose()
})

test('feature A opens a plugin error dialog when the fork is unavailable', async () => {
  const harness = boot()
  harness.ctx.uiWorkspace.forkSession = async () => {
    const error = new Error('no completed turn')
    error.name = 'SessionForkError'
    error.rpcError = { code: 'session/fork-unavailable' }
    throw error
  }

  await harness.store.startForkAndCompact('source-session')
  const state = harness.store.getSnapshot()
  assert.equal(state.phase, 'error')
  assert.equal(state.errorCode, 'fork-unavailable')
  assert.equal(state.errorMessage, 'no completed turn')
})

test('feature B loads the current summary and busy state through status', async () => {
  const harness = boot()
  const requests = []
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    return response({
      ok: true,
      summary: 'current summary',
      replaceCount: 4,
      replaceTokens: 120,
      compactionId: 'c1',
      commandId: 'cmd1',
      busy: true,
    })
  }

  await harness.store.openFromCard('session-1', 'c1')
  const state = harness.store.getSnapshot()
  assert.deepEqual(requests[0], { op: 'status', sessionId: 'session-1', compactionId: 'c1' })
  assert.equal(state.phase, 'editing')
  assert.equal(state.draft, 'current summary')
  assert.equal(state.replaceTokens, 120)
  assert.equal(state.compactionId, 'c1')
  assert.equal(state.busy, true)
  harness.store.setDraft('edited summary')
  const requestCount = requests.length
  await harness.store.submit()
  await harness.store.removeTail()
  assert.equal(requests.length, requestCount, 'busy mutations are client-side no-ops')
  assert.equal(harness.store.getSnapshot().phase, 'editing')
})

test('feature B submits the edited text and closes on success', async () => {
  const harness = boot()
  const requests = []
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    if (body.op === 'status') {
      return response({
        ok: true,
        summary: 'old summary',
        replaceCount: 1,
        replaceTokens: 10,
        compactionId: 'c1',
        commandId: null,
        busy: false,
      })
    }
    return response({ ok: true, changed: true })
  }

  await harness.store.openFromCard('session-1', 'c1')
  harness.store.setDraft('edited summary')
  await harness.store.submit()

  assert.deepEqual(requests[1], {
    op: 'apply',
    sessionId: 'session-1',
    compactionId: 'c1',
    text: 'edited summary',
  })
  assert.equal(harness.store.getSnapshot().phase, 'idle')
})

test('feature B turns a busy apply failure back into the editing state', async () => {
  const harness = boot()
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    if (body.op === 'status') {
      return response({
        ok: true,
        summary: 'old summary',
        replaceCount: 1,
        replaceTokens: 10,
        compactionId: 'c1',
        commandId: null,
        busy: false,
      })
    }
    return response({ ok: false, code: 'busy', message: 'session is running' })
  }

  await harness.store.openFromCard('session-1', 'c1')
  harness.store.setDraft('edited summary')
  await harness.store.submit()
  const state = harness.store.getSnapshot()
  assert.equal(state.phase, 'editing')
  assert.equal(state.busy, true)
  assert.equal(state.errorCode, 'busy')
  assert.equal(state.draft, 'edited summary')
})

test('feature B reports a changed card as an error dialog', async () => {
  const harness = boot()
  globalThis.fetch = async () =>
    response({ ok: false, code: 'changed', message: 'the current compaction card changed' })

  await harness.store.openFromCard('session-1', 'c1')
  const state = harness.store.getSnapshot()
  assert.equal(state.phase, 'error')
  assert.equal(state.errorCode, 'changed')
})

test('feature B translates the draft and still requires submit', async () => {
  const harness = boot()
  const requests = []
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    if (body.op === 'status') {
      return response({
        ok: true,
        summary: 'original summary',
        replaceCount: 1,
        replaceTokens: 10,
        compactionId: 'c1',
        commandId: 'cmd1',
        busy: false,
      })
    }
    if (body.op === 'translate') {
      return response({
        ok: true,
        text: '翻译后的内容',
        model: 'DeepSeek Test',
        reasoningEffort: 'off',
        lowThinking: true,
      })
    }
    return response({ ok: true, changed: true })
  }

  await harness.store.openFromCard('session-1', 'c1')
  await harness.store.translate()
  const translated = harness.store.getSnapshot()
  assert.deepEqual(requests[1], {
    op: 'translate',
    sessionId: 'session-1',
    text: 'original summary',
  })
  assert.equal(translated.phase, 'editing')
  assert.equal(translated.draft, '翻译后的内容')
  assert.equal(translated.translating, false)
  assert.equal(translated.translateError, null)
  assert.equal(translated.translateModel, 'DeepSeek Test')
  assert.equal(translated.translateLowThinking, true)
  assert.equal(translated.translateEffort, 'off')

  await harness.store.submit()
  assert.equal(requests[2].op, 'apply')
  assert.equal(requests[2].text, '翻译后的内容')
  assert.equal(harness.store.getSnapshot().phase, 'idle')
})

test('feature B keeps the draft when translation fails', async () => {
  const harness = boot()
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    if (body.op === 'status') {
      return response({
        ok: true,
        summary: 'original summary',
        replaceCount: 1,
        replaceTokens: 10,
        compactionId: 'c1',
        commandId: null,
        busy: false,
      })
    }
    return response({ ok: false, code: 'translate-failed', message: 'model unavailable' })
  }

  await harness.store.openFromCard('session-1', 'c1')
  await harness.store.translate()
  const state = harness.store.getSnapshot()
  assert.equal(state.phase, 'editing')
  assert.equal(state.draft, 'original summary')
  assert.equal(state.translating, false)
  assert.equal(state.translateError, 'translate-failed')
  assert.equal(state.translateErrorMessage, 'model unavailable')
})

test('feature B cancel discards the draft without a host action', async () => {
  const harness = boot()
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return response({
      ok: true,
      summary: 'original summary',
      replaceCount: 1,
      replaceTokens: 10,
      compactionId: 'c1',
      commandId: null,
      busy: false,
    })
  }

  await harness.store.openFromCard('session-1', 'c1')
  harness.store.setDraft('changed draft')
  harness.store.close()
  assert.equal(harness.store.getSnapshot().phase, 'idle')
  assert.equal(requests, 1)
})

test('better branch opens the editor on the new card without any trim', async () => {
  const harness = boot()
  const calls = []
  const requests = []
  let statusCalls = 0
  harness.ctx.uiWorkspace.openSession = (sessionId) => calls.push(['open', sessionId])
  harness.ctx.remote.commands.execute = (sessionId, line) => {
    calls.push(['execute', sessionId, line])
    return Promise.resolve({
      ok: true,
      value: { commandId: 'command-1', result: { kind: 'success' } },
    })
  }
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    if (body.op !== 'status') {
      return response({ ok: false, code: 'unexpected', message: 'unexpected request' })
    }
    if (body.compactionId === 'c-new') {
      return response(statusPayload({ compactionId: 'c-new', summary: 'compacted' }))
    }
    statusCalls += 1
    if (statusCalls === 1) {
      return response({ ok: false, code: 'none', message: 'no compaction card is available' })
    }
    return response(statusPayload({ compactionId: 'c-new', summary: 'compacted' }))
  }

  await harness.store.startForkAndCompact('source-session')
  await waitForWatcher()
  const state = harness.store.getSnapshot()
  assert.equal(state.phase, 'editing')
  assert.equal(state.compactionId, 'c-new')
  assert.equal(state.draft, 'compacted')
  assert.equal(state.tailCount, 1)
  assert.deepEqual(calls[0], ['open', 'child-session'])
  assert.deepEqual(calls[1], ['execute', 'child-session', '/compact'])
  assert.equal(requests.some((item) => item.op === 'arm'), false)
  assert.equal(requests.some((item) => item.op === 'apply'), false)
  assert.equal(requests.some((item) => item.op === 'remove'), false)
  harness.store.dispose()
})


test('compaction-card branch is a plain fork and does not compact', async () => {
  const harness = boot()
  const forks = []
  const opens = []
  harness.ctx.sessions.fork = async (args) => {
    forks.push(args)
    return 'card-child'
  }
  harness.ctx.uiWorkspace.openSession = (sessionId) => opens.push(sessionId)

  await harness.branchAtCard('session-1', 64)
  assert.deepEqual(forks[0], {
    sessionId: 'session-1',
    atSeq: 64,
    increaseTitle: true,
    allowMigration: false,
  })
  assert.deepEqual(opens, ['card-child'])
  assert.equal(harness.store.getSnapshot().phase, 'idle')
  harness.store.dispose()
})

test('compaction-card branch reuses the operation error dialog', async () => {
  const harness = boot()
  harness.ctx.sessions.fork = async () => {
    const error = new Error('no completed turn')
    error.name = 'SessionForkError'
    error.rpcError = { code: 'session/fork-unavailable', message: 'no completed turn' }
    throw error
  }

  await harness.branchAtCard('session-1', 64)
  const state = harness.store.getSnapshot()
  assert.equal(state.phase, 'error')
  assert.equal(state.errorCode, 'fork-unavailable')
  assert.equal(state.errorMessage, 'no completed turn')
  harness.store.dispose()
})

test('remove drops the whole tail and keeps the editor open', async () => {
  const harness = boot()
  const requests = []
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    if (body.op === 'status') {
      const removed = requests.some((item) => item.op === 'remove')
      return response(
        removed
          ? statusPayload({
              tailCount: 0,
              spanCount: 1,
              canRemove: false,
            })
          : statusPayload(),
      )
    }
    if (body.op === 'remove') return response({ ok: true, changed: true })
    return response({ ok: false, code: 'unexpected', message: 'unexpected request' })
  }

  await harness.store.openFromCard('session-1', 'c1')
  harness.store.setDraft('new summary')
  await harness.store.removeTail()
  const state = harness.store.getSnapshot()
  assert.deepEqual(
    requests.find((item) => item.op === 'remove'),
    {
      op: 'remove',
      sessionId: 'session-1',
      compactionId: 'c1',
      text: 'new summary',
    },
  )
  assert.equal(state.phase, 'editing')
  assert.equal(state.tailCount, 0)
  assert.equal(state.canRemove, false)
  harness.store.dispose()
})

test('started status disables tail editing', async () => {
  const harness = boot()
  globalThis.fetch = async () =>
    response(
      statusPayload({
        started: true,
        canRemove: false,
      }),
    )

  await harness.store.openFromCard('session-1', 'c1')
  const state = harness.store.getSnapshot()
  assert.equal(state.started, true)
  assert.equal(state.canRemove, false)
  harness.store.dispose()
})

