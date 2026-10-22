window.__ModuleLoader__.load({
  id: 'dsh-better-fork',
  factory(require) {
    const React = require('react')
    const { useEffect, useRef, useSyncExternalStore } = React
    const h = React.createElement

    const NS = 'betterFork'
    const API_PATH = '/dsh-better-fork/api'
    const EDIT_ACTION_KIND = 'compaction-edit-action'
    const PROJECTION_KEY = 'compactionEdit'

    /**
     * The start-here mark: a frameless, hollow play triangle. Its left edge
     * bows inward so the top and bottom corners stay pointed, while the right
     * tip keeps the forward/continue direction. The mark spans most of the
     * 16×16 box and uses the official 1px currentColor stroke, so it matches
     * the outline weight of the shipped action icons.
     * @param size - rendered square size.
     * @returns SVG element.
     */
    function playIcon(size = 16) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          strokeWidth: 1,
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', {
          d: 'M1.5 0.9Q6.4 8 1.5 15.1L14.9 8Z',
          fill: 'none',
          stroke: 'currentColor',
        }),
      )
    }

    /**
     * The shipped branch mark, copied locally for the compaction-card action:
     * a fork into two branches with two endpoint nodes, official 1px stroke.
     * @param size - rendered square size.
     * @returns SVG element.
     */
    function branchIcon(size = 16) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          strokeWidth: 1,
          'aria-hidden': 'true',
        },
        h('path', {
          d: 'M1.01503 8.0001L5.6964 8.0001C6.41913 8.0001 6.78049 8.0001 7.12115 7.91951C7.4232 7.84804 7.71233 7.73014 7.97821 7.57C8.27809 7.38939 8.5364 7.13669 9.05303 6.63129L11.3281 4.40564',
          stroke: 'currentColor',
        }),
        h('path', {
          d: 'M1.01221 7.9999L5.6964 7.9999C6.41913 7.9999 6.78049 7.9999 7.12115 8.08049C7.4232 8.15196 7.71233 8.26986 7.97821 8.43C8.27809 8.61061 8.5364 8.86331 9.05303 9.36871L11.3281 11.5944',
          stroke: 'currentColor',
        }),
        h('circle', {
          cx: 12.4502,
          cy: 3.3079,
          r: 1.56962,
          stroke: 'currentColor',
        }),
        h('circle', {
          cx: 12.4502,
          cy: 12.6921,
          r: 1.56962,
          stroke: 'currentColor',
        }),
      )
    }

    /** Slot-owned styles: unmounting the slot entry removes the element. */
    function PluginStyles() {
      return h('style', { 'data-dsh-better-fork': '' }, CSS)
    }

    /** Local host-shaped menu row, copied from the shipped menu pattern. */
    function MenuItemButton({ icon, children, onSelect }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          className: 'dsh-bf-menuItem',
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            onSelect()
          },
        },
        h('span', { className: 'dsh-bf-menuIcon' }, icon),
        h('span', { className: 'dsh-bf-menuLabel' }, children),
      )
    }

    const EN = {
      editContext: 'Edit context',
      'cardBranch.label': 'Branch',
      'cardBranch.title': 'Fork this compaction card at its latest end.',
      'betterBranch.menu.label': 'Start here',
      'betterBranch.node.title': 'Start a new session here',
      'removeTail.label': 'Remove last conversation node',
      'removeTail.title':
        'Remove every conversation node after the compaction checkpoint; only the compaction remains in model context.',
      'removeTail.processing': 'Removing…',
      'dialog.title': 'Edit compacted context',
      'dialog.errorTitle': 'Operation failed',
      'dialog.loading': 'Loading compacted context…',
      'dialog.stats':
        'Official compaction keeps the last conversation node by default; {tail} context node(s) are retained (compacted content ~{tokens} tokens).',
      'dialog.statsEmpty':
        'Official compaction keeps the last conversation node by default; no context nodes follow the compacted content (compacted content ~{tokens} tokens).',
      'dialog.warning':
        'Need to remove these nodes? Submitting only rewrites the compacted content; it does not remove them. To keep only the compacted content, use Remove last conversation node; removal cannot be undone.',
      'dialog.warningEmpty':
        'There are no context nodes left to remove; submitting only rewrites the compacted content.',
      'dialog.busy': 'This session is running. Try again after it becomes idle.',
      'dialog.submit': 'Submit',
      'dialog.saving': 'Saving…',
      'dialog.cancel': 'Cancel',
      'dialog.translate': 'Translate',
      'dialog.translating': 'Translating…',
      'dialog.translateInfo': 'Translation uses {model}',
      'dialog.translateInfoOff': 'Translation uses {model} · no thinking',
      'dialog.translateInfoLow': 'Translation uses {model} · low thinking',
      'dialog.translateInfoDefault': 'Translation uses {model} · model default mode',
      'dialog.currentModel': 'the current session model',
      'dialog.close': 'Close',
      'error.fork-unavailable': 'This session has no completed turn to start from.',
      'error.migration-required':
        'Open the original session to complete migration before starting a new session.',
      'error.fork-failed': 'Could not start the new session.',
      'error.busy': 'The session is running. Try again after it becomes idle.',
      'error.changed': 'The compacted context changed. Reopen the editor.',
      'error.empty': 'The content must not be empty.',
      'error.too-large': 'The content is too long.',
      'error.persistence': 'The edit was applied but the session could not be saved.',
      'error.none': 'There is no editable compaction card in this session.',
      'error.session-unavailable': 'The session is unavailable.',
      'error.network': 'Could not reach the DSH host.',
      'error.translate-failed': 'Translation failed. The editor was left unchanged; try again.',
      'error.started': 'The conversation has already started; this compaction can no longer be edited.',
      'error.auto': 'This compaction was triggered automatically and is read-only.',
      'error.unknown': 'The operation failed.',
    }

    const ZH = {
      editContext: '编辑上下文',
      'cardBranch.label': '分叉',
      'cardBranch.title': '从这张压缩卡片的最新位置分叉。',
      'betterBranch.menu.label': '从这里开始',
      'betterBranch.node.title': '从这里开启新的会话',
      'removeTail.label': '移除最后一个对话节点',
      'removeTail.title': '移除压缩 checkpoint 之后的全部对话节点，模型上下文只保留压缩内容。',
      'removeTail.processing': '移除中…',
      'dialog.title': '编辑压缩上下文',
      'dialog.errorTitle': '操作失败',
      'dialog.loading': '正在读取压缩上下文…',
      'dialog.stats':
        '官方压缩默认保留最后一个对话节点；当前保留 {tail} 条上下文节点（压缩内容约 {tokens} tokens）。',
      'dialog.statsEmpty':
        '官方压缩默认保留最后一个对话节点；当前压缩内容之后没有保留节点（压缩内容约 {tokens} tokens）。',
      'dialog.warning':
        '是否需要移除这些节点？提交只改写压缩内容，不会移除它们。如果需要模型只保留压缩内容，请使用「移除最后一个对话节点」；移除后不可恢复。',
      'dialog.warningEmpty':
        '当前没有可移除的上下文节点；提交只改写压缩内容。',
      'dialog.busy': '当前会话正在运行，结束后再试。',
      'dialog.submit': '提交',
      'dialog.saving': '保存中…',
      'dialog.cancel': '取消',
      'dialog.translate': '翻译',
      'dialog.translating': '翻译中…',
      'dialog.translateInfo': '翻译使用 {model}',
      'dialog.translateInfoOff': '翻译使用 {model} · 不思考',
      'dialog.translateInfoLow': '翻译使用 {model} · 低思考',
      'dialog.translateInfoDefault': '翻译使用 {model} · 模型默认模式',
      'dialog.currentModel': '当前会话模型',
      'dialog.close': '关闭',
      'error.fork-unavailable': '当前会话没有已完成的一轮，无法从这里开始。',
      'error.migration-required': '请先打开原会话完成迁移，再从这里开始。',
      'error.fork-failed': '创建新会话失败。',
      'error.busy': '当前会话正在运行，请结束后再试。',
      'error.changed': '压缩上下文已变化，请重新打开编辑窗口。',
      'error.empty': '内容不能为空。',
      'error.too-large': '内容超出长度限制。',
      'error.persistence': '编辑已应用，但会话未能保存。',
      'error.none': '当前会话没有可编辑的压缩卡片。',
      'error.session-unavailable': '会话不可用。',
      'error.network': '无法连接 DSH 宿主。',
      'error.translate-failed': '翻译失败，编辑框内容未改变，请重试。',
      'error.started': '对话已经开始，这张压缩卡片不能再编辑。',
      'error.auto': '这张压缩由系统自动触发，只能查看，不能编辑。',
      'error.unknown': '操作失败。',
    }

    const KNOWN_ERRORS = new Set([
      'fork-unavailable',
      'migration-required',
      'fork-failed',
      'busy',
      'changed',
      'empty',
      'too-large',
      'persistence',
      'none',
      'session-unavailable',
      'network',
      'translate-failed',
      'started',
      'auto',
      'unknown',
    ])

    const CSS = `
.dsh-bf-menuItem {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
.dsh-bf-menuIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-menu-icon);
}
.dsh-bf-menuIcon svg {
  width: 14px;
  height: 14px;
}
.dsh-bf-menuLabel {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-bf-menuItem:hover:not(:disabled),
.dsh-bf-menuItem:focus-visible:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}
.dsh-bf-menuItem:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.dsh-bf-actionRow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 8px;
  padding: 2px 0 2px 22px;
}
.dsh-bf-cardAction {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dsh-bf-cardAction:hover {
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-bf-assistantBranch {
  box-sizing: border-box;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: calc(28px + var(--dsh-content-font-delta, 0px));
  height: calc(28px + var(--dsh-content-font-delta, 0px));
  padding: 6px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  order: 1;
}
[data-clock='end']:has(.dsh-bf-assistantBranch) > span:last-child {
  order: 2;
}
.dsh-bf-assistantBranch:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
.dsh-bf-assistantBranch:focus-visible {
  outline: 1.5px solid var(--dsw-alias-label-secondary);
  outline-offset: 1px;
}
.dsh-bf-assistantBranch svg {
  width: calc(17px + var(--dsh-content-font-delta, 0px));
  height: calc(17px + var(--dsh-content-font-delta, 0px));
}
.dsh-bf-cardAction:focus-visible {
  outline: 1.5px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsh-bf-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 36%, transparent);
}
.dsh-bf-dialog {
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  max-height: min(720px, calc(100vh - 48px));
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 24px 80px color-mix(in srgb, var(--dsw-alias-bg-base) 35%, transparent);
  font-family: inherit;
}
.dsh-bf-errorDialog {
  width: min(480px, calc(100vw - 48px));
  max-height: min(70vh, calc(100vh - 48px));
}
.dsh-bf-panel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: min(calc(100dvh - 150px), 920px);
  min-height: 420px;
  margin: 6px 0;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
}
.dsh-bf-panel .dsh-bf-body {
  flex: 1;
  min-height: 0;
}
.dsh-bf-panel .dsh-bf-textarea {
  flex: 1;
  min-height: 140px;
  max-height: none;
  resize: none;
}
.dsh-bf-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-bf-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-bf-iconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dsh-bf-iconButton:hover:not(:disabled) {
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-bf-iconButton:disabled {
  opacity: 0.5;
  cursor: default;
}
.dsh-bf-iconButton:focus-visible {
  outline: 1.5px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsh-bf-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  overflow: auto;
}
.dsh-bf-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px 0;
  color: var(--dsw-alias-label-secondary);
}
.dsh-bf-spinner {
  flex: none;
  width: 14px;
  height: 14px;
  border: 2px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-brand-primary);
  border-radius: 50%;
  animation: dsh-bf-spin 0.8s linear infinite;
}
@keyframes dsh-bf-spin {
  to { transform: rotate(360deg); }
}
.dsh-bf-meta {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dsh-bf-warning {
  color: var(--dsw-alias-state-warn-primary);
  font-size: 12px;
  line-height: 1.65;
}
.dsh-bf-textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 320px;
  max-height: 52vh;
  resize: vertical;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1.7;
  outline: none;
}
.dsh-bf-textarea:focus {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent);
}
.dsh-bf-textarea:disabled {
  opacity: 0.7;
}
.dsh-bf-busy {
  color: var(--dsw-alias-state-warn-primary);
  font-size: 12px;
  line-height: 1.6;
}
.dsh-bf-error {
  color: var(--dsw-alias-state-error-primary);
  font-size: 13px;
  line-height: 1.6;
}
.dsh-bf-detail {
  margin-top: 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.dsh-bf-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-bf-footerActions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsh-bf-contextActions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dsh-bf-primary,
.dsh-bf-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 16px;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dsh-bf-primary {
  border: 1px solid var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
}
.dsh-bf-primary:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 86%, var(--dsw-alias-bg-base));
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 86%, var(--dsw-alias-bg-base));
}
.dsh-bf-primary:disabled {
  opacity: 0.5;
  cursor: default;
}
.dsh-bf-secondary {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-bf-secondary:hover:not(:disabled) {
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-bf-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}
.dsh-bf-primary:focus-visible,
.dsh-bf-secondary:focus-visible {
  outline: 1.5px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsh-bf-btnSpinner {
  flex: none;
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: dsh-bf-spin 0.8s linear infinite;
}
.dsh-bf-toast {
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 13%, transparent);
  color: var(--dsw-alias-state-error-primary);
  font-size: 13px;
  line-height: 1.6;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-bf-spinner { animation: none; }
}
`

    /**
     * Create the dialog state machine shared by the row action, the Chat
     * action and the overlay.
     * @param ctx - Client Cordis context.
     * @returns store face.
     */
    function createEditorStore(ctx) {
      const IDLE = Object.freeze({
        phase: 'idle',
        openId: 0,
        sessionId: null,
        compactionId: null,
        draft: '',
        replaceTokens: 0,
        tailCount: 0,
        started: false,
        canRemove: false,
        busy: false,
        translating: false,
        mutating: false,
        errorCode: null,
        errorMessage: null,
        translateError: null,
        translateErrorMessage: null,
        translateModel: null,
        translateLowThinking: null,
        translateEffort: null,
      })

      let state = IDLE
      const listeners = new Set()
      let controller = null
      let openSeq = 0
      let forking = false
      let branching = false
      let disposed = false
      let watchController = null
      let watchTimer = null

      const set = (next) => {
        state = next
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.error('[dsh-better-fork] store listener failed', error)
          }
        }
      }

      const subscribe = (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }

      const getSnapshot = () => state

      /**
       * POST one short API request.
       * @param body - JSON body.
       * @param signal - abort signal.
       * @returns parsed payload.
       */
      const post = async (body, signal) => {
        let response
        try {
          response = await fetch(API_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          })
        } catch (error) {
          if (error && error.name === 'AbortError') throw error
          const failure = new Error(error instanceof Error ? error.message : String(error))
          failure.code = 'network'
          throw failure
        }

        let payload = {}
        const text = await response.text().catch(() => '')
        if (text !== '') {
          try {
            const parsed = JSON.parse(text)
            if (parsed !== null && typeof parsed === 'object') payload = parsed
          } catch {
            // Keep the empty payload; the status code still reports the failure.
          }
        }

        if (!response.ok) {
          const failure = new Error(
            typeof payload.message === 'string' && payload.message !== ''
              ? payload.message
              : `HTTP ${response.status}`,
          )
          failure.code = typeof payload.code === 'string' ? payload.code : 'network'
          throw failure
        }

        if (payload.ok !== true) {
          const failure = new Error(
            typeof payload.message === 'string' && payload.message !== ''
              ? payload.message
              : typeof payload.code === 'string'
                ? payload.code
                : 'host error',
          )
          failure.code = typeof payload.code === 'string' ? payload.code : 'unknown'
          throw failure
        }

        return payload
      }

      /**
       * Show a fork/operation failure in the small global error dialog.
       * @param error - thrown/returned failure.
       */
      const setForkError = (error) => {
        set({
          ...IDLE,
          phase: 'error',
          openId: ++openSeq,
          errorCode: forkErrorCode(error),
          errorMessage:
            error !== null && typeof error === 'object' && 'message' in error
              ? String(error.message)
              : String(error),
        })
      }

      /**
       * Official client fork at an exact inclusive boundary. This is the same
       * `sessions.fork` path the shipped branch action uses, including the
       * inherited-title increment.
       * @param sessionId - source Session.
       * @param atSeq - exact event boundary.
       * @returns child Session id.
       */
      const forkAt = async (sessionId, atSeq) => {
        const childId = await ctx.sessions.fork({
          sessionId,
          atSeq,
          increaseTitle: true,
          allowMigration: false,
        })
        if (typeof childId !== 'string' || childId.length === 0) {
          throw new Error('the Host returned no child Session')
        }
        return childId
      }

      /**
       * Common start-here tail: open the child, run the official /compact,
       * then wait for its new card and open the editor. No context cleanup.
       * @param childId - new child Session.
       */
      const beginBetterBranch = async (childId) => {
        if (disposed) return
        try {
          ctx.uiWorkspace.openSession(childId)
        } catch (error) {
          setForkError(error)
          return
        }

        let beforeCompactionId = null
        try {
          const before = await post({ op: 'status', sessionId: childId })
          if (typeof before.compactionId === 'string') {
            beforeCompactionId = before.compactionId
          }
        } catch (error) {
          // A fresh fork normally has no card yet; that is not an error.
          if (!(error && error.code === 'none')) {
            console.warn('[dsh-better-fork] could not read the child card', error)
          }
        }

        if (disposed) return

        let pending
        try {
          pending = ctx.remote.commands.execute(childId, '/compact', [])
        } catch (error) {
          console.warn('[dsh-better-fork] could not invoke /compact', error)
          return
        }

        Promise.resolve(pending)
          .then((result) => {
            if (result === undefined || result === null || result.ok !== true) {
              console.warn('[dsh-better-fork] /compact remote failure', result)
              return
            }
            if (result.value === undefined) {
              console.warn('[dsh-better-fork] /compact command is unavailable')
              return
            }
            if (result.value.result && result.value.result.kind === 'error') {
              // The official command card already shows this failure.
              return
            }
            // Success: the projection exposes the edit entry on the card.
          })
          .catch((error) => {
            console.warn('[dsh-better-fork] /compact failed', error)
          })

        watchBranch(childId, beforeCompactionId)
      }

      /**
       * Session-menu start-here: official fork at the latest completed turn,
       * official /compact, then auto-open the editor.
       * @param sourceId - source Session.
       */
      const startForkAndCompact = async (sourceId) => {
        if (disposed || forking) return
        forking = true
        try {
          let childId
          try {
            childId = await ctx.uiWorkspace.forkSession(sourceId, undefined, {
              allowMigration: false,
            })
          } catch (error) {
            setForkError(error)
            return
          }
          if (disposed) return
          if (typeof childId !== 'string' || childId.length === 0) {
            setForkError(new Error('the Host returned no child Session'))
            return
          }
          await beginBetterBranch(childId)
        } finally {
          forking = false
        }
      }

      /**
       * Start a new session at one exact boundary: official fork, official
       * /compact, then auto-open the editor.
       * @param sessionId - source Session.
       * @param atSeq - node boundary seq.
       */
      const startForkAtAndCompact = async (sessionId, atSeq) => {
        if (disposed || forking) return
        if (typeof sessionId !== 'string' || sessionId.length === 0) return
        if (!Number.isSafeInteger(atSeq) || atSeq < 0) return
        forking = true
        try {
          let childId
          try {
            childId = await forkAt(sessionId, atSeq)
          } catch (error) {
            setForkError(error)
            return
          }
          if (disposed) return
          await beginBetterBranch(childId)
        } finally {
          forking = false
        }
      }

      /**
       * Resolve a durable message id to its committed seq through the Host,
       * then start the new session there. The official assistant action row
       * only exposes the message id, not the seq.
       * @param sessionId - source Session.
       * @param messageId - durable assistant message id.
       */
      const startForkAtMessage = async (sessionId, messageId) => {
        if (disposed || forking) return
        if (typeof sessionId !== 'string' || typeof messageId !== 'string') return
        try {
          const result = await post({ op: 'messageSeq', sessionId, messageId })
          if (!Number.isSafeInteger(result.seq) || result.seq < 0) {
            setForkError(new Error('message seq is unavailable'))
            return
          }
          await startForkAtAndCompact(sessionId, result.seq)
        } catch (error) {
          setForkError(error)
        }
      }

      /**
       * Compaction-card start-here: plain official fork at the card end, switch,
       * no /compact, no editor auto-open.
       * @param sessionId - source Session.
       * @param atSeq - card end seq.
       */
      const branchAtCard = async (sessionId, atSeq) => {
        if (disposed || branching) return
        if (typeof sessionId !== 'string' || sessionId.length === 0) return
        if (!Number.isSafeInteger(atSeq) || atSeq < 0) return
        branching = true
        try {
          let childId
          try {
            childId = await forkAt(sessionId, atSeq)
          } catch (error) {
            setForkError(error)
            return
          }
          if (disposed) return
          try {
            ctx.uiWorkspace.openSession(childId)
          } catch (error) {
            setForkError(error)
          }
        } finally {
          branching = false
        }
      }

      /**
       * Feature B: open the editor for the current compaction card.
       * @param sessionId - current Session.
       * @param compactionId - card identity from the action node.
       */
      const openFromCard = async (sessionId, compactionId) => {
        if (disposed) return
        if (typeof sessionId !== 'string' || sessionId.length === 0) return
        controller?.abort()
        controller = new AbortController()
        const signal = controller.signal
        const openId = ++openSeq
        set({
          ...IDLE,
          phase: 'loading',
          openId,
          sessionId,
          compactionId: typeof compactionId === 'string' ? compactionId : null,
        })

        try {
          const result = await post(
            {
              op: 'status',
              sessionId,
              ...(typeof compactionId === 'string' && compactionId.length > 0
                ? { compactionId }
                : {}),
            },
            signal,
          )
          if (signal.aborted) return
          const summary = typeof result.summary === 'string' ? result.summary : ''
          set({
            phase: 'editing',
            openId,
            sessionId,
            compactionId:
              typeof result.compactionId === 'string' ? result.compactionId : compactionId ?? null,
            draft: summary,
            replaceTokens:
              typeof result.replaceTokens === 'number' && result.replaceTokens >= 0
                ? result.replaceTokens
                : 0,
            tailCount:
              typeof result.tailCount === 'number' && result.tailCount >= 0
                ? result.tailCount
                : 0,
            started: result.started === true,
            canRemove: result.canRemove === true,
            busy: result.busy === true,
            translateModel: null,
            translateLowThinking: null,
            translateEffort: null,
            translating: false,
            mutating: false,
            errorCode: null,
            errorMessage: null,
            translateError: null,
            translateErrorMessage: null,
          })
        } catch (error) {
          if (signal.aborted || (error && error.name === 'AbortError')) return
          set({
            ...IDLE,
            phase: 'error',
            openId,
            errorCode: error && typeof error.code === 'string' ? error.code : 'unknown',
            errorMessage: error instanceof Error ? error.message : String(error),
          })
        }
      }

      /**
       * Wait for the branch's official compact, then open the editor. A new
       * card id different from the child's pre-compaction card is enough; the
       * start-here flow performs no context cleanup.
       * @param childId - new child Session.
       * @param beforeCompactionId - the inherited card id, or null.
       */
      const watchBranch = (childId, beforeCompactionId) => {
        watchController?.abort()
        if (watchTimer !== null) {
          clearTimeout(watchTimer)
          watchTimer = null
        }
        const branchController = new AbortController()
        watchController = branchController
        const started = Date.now()
        const timeoutMs = 5 * 60_000
        const tick = async () => {
          watchTimer = null
          if (disposed || branchController.signal.aborted) return
          if (Date.now() - started > timeoutMs) return
          try {
            const result = await post(
              { op: 'status', sessionId: childId },
              branchController.signal,
            )
            if (branchController.signal.aborted) return
            const card =
              typeof result.compactionId === 'string' ? result.compactionId : null
            if (card !== null && card !== beforeCompactionId) {
              await openFromCard(childId, card)
              return
            }
          } catch (error) {
            if (branchController.signal.aborted) return
            // Keep waiting through transient host errors until the timeout.
          }
          if (!branchController.signal.aborted) {
            watchTimer = setTimeout(tick, 750)
          }
        }
        watchTimer = setTimeout(tick, 750)
      }

      /**
       * Update the editable draft.
       * @param draft - textarea value.
       */
      const setDraft = (draft) => {
        if (state.phase !== 'editing' || state.translating || state.mutating) return
        set({ ...state, draft: typeof draft === 'string' ? draft : '' })
      }

      /**
       * Submit the edited text through the Host's short apply route.
       */
      const submit = async () => {
        if (state.phase !== 'editing' || state.translating || state.mutating || state.busy) return
        const base = state
        const text = typeof base.draft === 'string' ? base.draft : ''
        if (text.trim().length === 0) return

        controller?.abort()
        controller = new AbortController()
        const signal = controller.signal
        set({ ...base, phase: 'saving', errorCode: null, errorMessage: null })

        try {
          await post(
            {
              op: 'apply',
              sessionId: base.sessionId,
              compactionId: base.compactionId,
              text,
            },
            signal,
          )
          if (signal.aborted) return
          set({ ...IDLE, openId: base.openId })
        } catch (error) {
          if (signal.aborted || (error && error.name === 'AbortError')) return
          const code = error && typeof error.code === 'string' ? error.code : 'unknown'
          if (code === 'persistence') {
            set({
              ...base,
              phase: 'error',
              errorCode: 'persistence',
              errorMessage: error instanceof Error ? error.message : String(error),
            })
            return
          }
          if (code === 'busy') {
            set({
              ...base,
              phase: 'editing',
              busy: true,
              errorCode: 'busy',
              errorMessage: error instanceof Error ? error.message : String(error),
            })
            return
          }
          set({
            ...base,
            phase: 'editing',
            errorCode: code,
            errorMessage: error instanceof Error ? error.message : String(error),
          })
        }
      }

      /**
       * Translate the current draft through the Host's original model route.
       * The translation is only a draft change; submitting still performs the
       * actual checkpoint transaction.
       */
      const translate = async () => {
        if (state.phase !== 'editing' || state.translating || state.mutating) return
        const base = state
        const text = typeof base.draft === 'string' ? base.draft : ''
        if (text.trim().length === 0) return

        controller?.abort()
        controller = new AbortController()
        const signal = controller.signal
        set({
          ...base,
          translating: true,
          errorCode: null,
          errorMessage: null,
          translateError: null,
          translateErrorMessage: null,
        })

        try {
          const result = await post(
            {
              op: 'translate',
              sessionId: base.sessionId,
              text,
            },
            signal,
          )
          if (signal.aborted || state.openId !== base.openId) return
          const translated = typeof result.text === 'string' ? result.text : ''
          if (translated.trim().length === 0) {
            throw new Error('the host returned an empty translation')
          }
          set({
            ...base,
            draft: translated,
            translateModel:
              typeof result.model === 'string' && result.model.length > 0
                ? result.model
                : base.translateModel,
            translateLowThinking:
              typeof result.lowThinking === 'boolean'
                ? result.lowThinking
                : base.translateLowThinking,
            translateEffort:
              typeof result.reasoningEffort === 'string'
                ? result.reasoningEffort
                : base.translateEffort,
            translating: false,
            errorCode: null,
            errorMessage: null,
            translateError: null,
            translateErrorMessage: null,
          })
        } catch (error) {
          if (signal.aborted || (error && error.name === 'AbortError')) return
          if (state.openId !== base.openId) return
          set({
            ...base,
            translating: false,
            translateError: 'translate-failed',
            translateErrorMessage:
              error instanceof Error ? error.message : String(error),
          })
        }
      }

      /**
       * Refresh the open editor from a status response without closing it.
       * @param base - state captured before the mutation.
       * @param signal - abort signal.
       * @param replaceDraft - whether the mutation changed the checkpoint text.
       */
      const refreshEditing = async (base, signal, replaceDraft) => {
        const result = await post(
          {
            op: 'status',
            sessionId: base.sessionId,
            ...(typeof base.compactionId === 'string' && base.compactionId.length > 0
              ? { compactionId: base.compactionId }
              : {}),
          },
          signal,
        )
        if (signal.aborted || state.openId !== base.openId) return
        const summary = typeof result.summary === 'string' ? result.summary : ''
        set({
          phase: 'editing',
          openId: base.openId,
          sessionId: base.sessionId,
          compactionId:
            typeof result.compactionId === 'string'
              ? result.compactionId
              : base.compactionId,
          draft: replaceDraft ? summary : base.draft,
          replaceTokens:
            typeof result.replaceTokens === 'number' && result.replaceTokens >= 0
              ? result.replaceTokens
              : 0,
          tailCount:
            typeof result.tailCount === 'number' && result.tailCount >= 0
              ? result.tailCount
              : 0,
          started: result.started === true,
          canRemove: result.canRemove === true,
          busy: result.busy === true,
          translateModel: base.translateModel ?? null,
          translateLowThinking: base.translateLowThinking ?? null,
          translateEffort: base.translateEffort ?? null,
          translating: false,
          mutating: false,
          errorCode: null,
          errorMessage: null,
          translateError: null,
          translateErrorMessage: null,
        })
      }

      /**
       * Remove the entire official tail after the checkpoint. The current
       * editor draft becomes the checkpoint text; the editor stays open.
       */
      const removeTail = async () => {
        if (state.phase !== 'editing' || state.translating || state.mutating || state.busy) return
        const base = state
        const text = typeof base.draft === 'string' ? base.draft : ''
        if (text.trim().length === 0) return

        controller?.abort()
        controller = new AbortController()
        const signal = controller.signal
        set({ ...base, mutating: true, errorCode: null, errorMessage: null })

        try {
          await post(
            {
              op: 'remove',
              sessionId: base.sessionId,
              compactionId: base.compactionId,
              text,
            },
            signal,
          )
          if (signal.aborted) return
          await refreshEditing(base, signal, true)
        } catch (error) {
          if (signal.aborted || (error && error.name === 'AbortError')) return
          set({
            ...base,
            mutating: false,
            errorCode: error && typeof error.code === 'string' ? error.code : 'unknown',
            errorMessage: error instanceof Error ? error.message : String(error),
          })
        }
      }

      /** Close the editor unless a save is in flight. */
      const close = () => {
        if (state.phase === 'saving') return
        controller?.abort()
        controller = null
        set({ ...IDLE, openId: state.openId })
      }

      /** Release pending work when the plugin unloads. */
      const dispose = () => {
        disposed = true
        controller?.abort()
        controller = null
        watchController?.abort()
        watchController = null
        if (watchTimer !== null) {
          clearTimeout(watchTimer)
          watchTimer = null
        }
        listeners.clear()
      }

      return {
        subscribe,
        getSnapshot,
        getLocaleSnapshot: () => ctx.locale.getSnapshot(),
        subscribeLocale: (listener) => ctx.locale.subscribe(listener),
        startForkAndCompact,
        startForkAtMessage,
        branchAtCard,
        openFromCard,
        setDraft,
        removeTail,
        translate,
        submit,
        close,
        dispose,
      }
    }

    /**
     * Map a fork failure to a stable client error code.
     * @param error - thrown fork failure.
     * @returns code.
     */
    function forkErrorCode(error) {
      const rpcCode = error?.rpcError?.code ?? error?.code
      if (rpcCode === 'session/migration-required') return 'migration-required'
      if (rpcCode === 'session/fork-unavailable') return 'fork-unavailable'
      return 'fork-failed'
    }

    /**
     * The Chat action attached immediately below a manual compaction card.
     * Automatic compaction cards keep their official rendering and get no
     * plugin action row; only the latest manual card renders the edit action.
     */
    function CompactionEditAction({
      node,
      sessionId,
      useProjection,
      useSessionAccess,
      openEditor,
      branchAtCard,
      store,
      t,
    }) {
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const view = useProjection(PROJECTION_KEY)
      const canBranch = useSessionAccess(sessionId, 'session/fork') === true
      // A manual `/compact` carries a command id; automatic compactions do not.
      // Automatic cards stay entirely official: no branch, edit, or remove row.
      const manual =
        view !== undefined &&
        view !== null &&
        typeof view.commandId === 'string' &&
        view.commandId.length > 0
      if (!manual) return null
      const compactionId = node?.data?.compactionId
      // ChatNode exposes the anchored event seq as `anchorSeq`; `endSeq` is not
      // a ChatNode field.
      const endSeq = node?.anchorSeq
      const isLatest =
        view !== undefined &&
        view !== null &&
        view.compactionId !== null &&
        view.compactionId === compactionId
      if (
        state.phase !== 'idle' &&
        state.sessionId === sessionId &&
        (state.compactionId === compactionId || state.compactionId === null)
      ) {
        // The editor is part of the conversation itself: it replaces this
        // card's action row and fills the chat viewport, with no page overlay.
        return h(EditDialog, { store, t })
      }
      const showEdit = isLatest && view.started !== true
      if (!canBranch && !showEdit) return null
      const branchLabel = t('cardBranch.title')
      return h(
        'div',
        { className: 'dsh-bf-actionRow' },
        h(PluginStyles),
        canBranch
          ? h(
              'button',
              {
                type: 'button',
                className: 'dsh-bf-cardAction',
                title: branchLabel,
                'aria-label': branchLabel,
                onClick: (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void branchAtCard(sessionId, endSeq)
                },
              },
              branchIcon(12),
              h('span', null, t('cardBranch.label')),
            )
          : null,
        showEdit
          ? h(
              'button',
              {
                type: 'button',
                className: 'dsh-bf-cardAction',
                title: t('editContext'),
                'aria-label': t('editContext'),
                onClick: () => openEditor(sessionId, compactionId),
              },
              pencilIcon(12),
              h('span', null, t('editContext')),
            )
          : null,
      )
    }

    /**
     * The start-here action inside the official finalized-assistant action
     * row. The owner supplies the durable message id; the Host maps it to the
     * committed seq and starts the new session there.
     */
    function AssistantStartAction({
      messageId,
      sessionId,
      useSessionAccess,
      startForkAtMessage,
      t,
    }) {
      const allowed = useSessionAccess(sessionId, 'session/fork')
      if (!allowed) return null
      const description = t('betterBranch.node.title')
      return h(
        React.Fragment,
        null,
        h(PluginStyles),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-bf-assistantBranch',
            title: description,
            'aria-label': description,
            onClick: (event) => {
              event.preventDefault()
              event.stopPropagation()
              void startForkAtMessage(sessionId, messageId)
            },
          },
          playIcon(16),
        ),
      )
    }

    /** Additional normal menu row, placed after every shipped row. */
    function StartSessionMenuItem({
      sessionId,
      useMenuOpenState,
      useSessionAccess,
      startForkAndCompact,
      t,
    }) {
      const [, setMenuOpen] = useMenuOpenState()
      const allowed = useSessionAccess(sessionId, 'session/fork')
      if (!allowed) return null
      const label = t('betterBranch.menu.label')
      return h(
        React.Fragment,
        null,
        h(PluginStyles),
        h(MenuItemButton, {
          icon: playIcon(16),
          onSelect: () => {
            setMenuOpen(false)
            void startForkAndCompact(sessionId)
          },
          children: label,
        }),
      )
    }

    /** The editor dialog, mounted once in the frame-wide overlay layer. */
    function EditDialog({ store, t }) {
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const locale = useSyncExternalStore(store.subscribeLocale, store.getLocaleSnapshot)
      const closeRef = useRef(null)
      const textareaRef = useRef(null)
      const restoreFocusRef = useRef(null)
      const focusedOpenRef = useRef(-1)

      useEffect(() => {
        if (
          (state.phase === 'loading' || state.phase === 'error') &&
          restoreFocusRef.current === null
        ) {
          restoreFocusRef.current =
            typeof document !== 'undefined' ? document.activeElement : null
        }
        if (state.phase === 'loading' || state.phase === 'error') {
          closeRef.current?.focus()
        }
        if (state.phase === 'idle' && restoreFocusRef.current !== null) {
          const target = restoreFocusRef.current
          restoreFocusRef.current = null
          try {
            target?.focus?.()
          } catch {
            // The row action may have unmounted; focusing it is optional.
          }
        }
      }, [state.phase])

      useEffect(() => {
        if (state.phase !== 'editing' || focusedOpenRef.current === state.openId) return
        focusedOpenRef.current = state.openId
        const editor = textareaRef.current
        if (editor === null) return
        editor.focus()
        editor.select()
      }, [state.phase, state.openId])

      if (state.phase === 'idle') return null

      const saving = state.phase === 'saving'
      const translating = state.phase === 'editing' && state.translating === true
      const editable = state.phase === 'editing' || saving
      const activeLocale = typeof locale?.active === 'string' ? locale.active.toLowerCase() : ''
      const isChinese = activeLocale.startsWith('zh')
      const localizedError = localizeError(t, state.errorCode)
      const localizedTranslateError =
        state.translateError !== null ? localizeError(t, state.translateError) : null
      const submitDisabled =
        !editable ||
        saving ||
        translating ||
        state.mutating ||
        state.busy ||
        state.draft.trim().length === 0
      const retainedTail = state.tailCount > 0
      const translateInfoKey =
        state.translateLowThinking === null
          ? 'dialog.translateInfo'
          : state.translateLowThinking
            ? /^(off|none|disabled?)$/i.test(state.translateEffort ?? '')
              ? 'dialog.translateInfoOff'
              : 'dialog.translateInfoLow'
            : 'dialog.translateInfoDefault'

      const close = () => store.close()

      const onKeyDown = (event) => {
        if (event.key === 'Escape' && !saving) {
          event.preventDefault()
          close()
          return
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key === 'Enter' &&
          editable &&
          !saving &&
          !translating &&
          !state.mutating &&
          !state.busy
        ) {
          event.preventDefault()
          void store.submit()
        }
      }

      return h(
        'div',
        {
          className: 'dsh-bf-panel',
          role: 'dialog',
          'aria-labelledby': 'dsh-bf-title',
          onKeyDown,
        },
        h(PluginStyles),
        h(
          'div',
          { className: 'dsh-bf-header' },
            h(
              'h2',
              { id: 'dsh-bf-title', className: 'dsh-bf-title' },
              state.phase === 'error' ? t('dialog.errorTitle') : t('dialog.title'),
            ),
            h(
              'button',
              {
                ref: closeRef,
                type: 'button',
                className: 'dsh-bf-iconButton',
                'aria-label': t('dialog.close'),
                title: t('dialog.close'),
                disabled: saving,
                onClick: close,
              },
              closeIcon(14),
            ),
          ),
          h(
            'div',
            { className: 'dsh-bf-body' },
            state.phase === 'loading'
              ? h(
                  'div',
                  { className: 'dsh-bf-loading' },
                  h('span', { className: 'dsh-bf-spinner', 'aria-hidden': true }),
                  t('dialog.loading'),
                )
              : null,
            editable
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'dsh-bf-meta' },
                    t(retainedTail ? 'dialog.stats' : 'dialog.statsEmpty', {
                      tokens: state.replaceTokens,
                      tail: state.tailCount,
                    }),
                  ),
                  h(
                    'div',
                    { className: 'dsh-bf-warning' },
                    t(retainedTail ? 'dialog.warning' : 'dialog.warningEmpty'),
                  ),
                  h(
                    'div',
                    { className: 'dsh-bf-meta' },
                    t(translateInfoKey, {
                      model: state.translateModel ?? t('dialog.currentModel'),
                    }),
                  ),
                  localizedTranslateError !== null
                    ? h(
                        'div',
                        { className: 'dsh-bf-toast', role: 'alert' },
                        localizedTranslateError,
                        state.translateErrorMessage !== null
                          ? h('div', { className: 'dsh-bf-detail' }, state.translateErrorMessage)
                          : null,
                      )
                    : null,
                  state.canRemove
                    ? h(
                        'div',
                        { className: 'dsh-bf-contextActions' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-bf-secondary',
                            title: t('removeTail.title'),
                            'aria-label': t('removeTail.title'),
                            disabled:
                              saving ||
                              translating ||
                              state.mutating ||
                              state.busy ||
                              state.draft.trim().length === 0,
                            onClick: () => void store.removeTail(),
                          },
                          state.mutating
                            ? t('removeTail.processing')
                            : t('removeTail.label'),
                        ),
                      )
                    : null,
                  h('textarea', {
                    ref: textareaRef,
                    className: 'dsh-bf-textarea',
                    value: state.draft,
                    disabled: saving || translating || state.mutating,
                    spellCheck: false,
                    'aria-label': t('dialog.title'),
                    onChange: (event) => store.setDraft(event.target.value),
                  }),
                  state.busy ? h('div', { className: 'dsh-bf-busy' }, t('dialog.busy')) : null,
                  state.errorCode !== null
                    ? h(
                        'div',
                        { className: 'dsh-bf-error', role: 'alert' },
                        localizedError,
                        state.errorMessage !== null
                          ? h('div', { className: 'dsh-bf-detail' }, state.errorMessage)
                          : null,
                      )
                    : null,
                )
              : null,
            state.phase === 'error'
              ? h(
                  'div',
                  { className: 'dsh-bf-error', role: 'alert' },
                  localizedError,
                  state.errorMessage !== null
                    ? h('div', { className: 'dsh-bf-detail' }, state.errorMessage)
                    : null,
                )
              : null,
          ),
          editable
            ? h(
                'div',
                { className: 'dsh-bf-footer' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-bf-secondary',
                    title: t('dialog.cancel'),
                    'aria-label': t('dialog.cancel'),
                    disabled: saving,
                    onClick: close,
                  },
                  t('dialog.cancel'),
                ),
                h(
                  'div',
                  { className: 'dsh-bf-footerActions' },
                  isChinese
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-bf-secondary',
                          title: t('dialog.translate'),
                          'aria-label': t('dialog.translate'),
                          disabled:
                            saving ||
                            translating ||
                            state.mutating ||
                            state.draft.trim().length === 0,
                          'aria-busy': translating ? 'true' : undefined,
                          onClick: () => void store.translate(),
                        },
                        translating
                          ? h('span', {
                              className: 'dsh-bf-btnSpinner',
                              'aria-hidden': true,
                            })
                          : null,
                        translating
                          ? t('dialog.translating')
                          : t('dialog.translate'),
                      )
                    : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-bf-primary',
                      title: t('dialog.submit'),
                      'aria-label': t('dialog.submit'),
                      disabled: submitDisabled,
                      onClick: () => void store.submit(),
                    },
                    saving ? t('dialog.saving') : t('dialog.submit'),
                  ),
                ),
              )
            : null,
      )
    }

    /**
     * The only global surface: a fork failure has no card to host the panel.
     * Outside clicks never dismiss it; the close button is explicit.
     */
    function ErrorDialog({ store, t }) {
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
      if (state.phase !== 'error' || state.sessionId !== null) return null
      const close = () => store.close()
      return h(
        'div',
        { className: 'dsh-bf-backdrop' },
        h(PluginStyles),
        h(
          'div',
          {
            className: 'dsh-bf-dialog dsh-bf-errorDialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'dsh-bf-error-title',
          },
          h(
            'div',
            { className: 'dsh-bf-header' },
            h(
              'h2',
              { id: 'dsh-bf-error-title', className: 'dsh-bf-title' },
              t('dialog.errorTitle'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-bf-iconButton',
                'aria-label': t('dialog.close'),
                title: t('dialog.close'),
                onClick: close,
              },
              closeIcon(14),
            ),
          ),
          h(
            'div',
            { className: 'dsh-bf-body' },
            h(
              'div',
              { className: 'dsh-bf-error', role: 'alert' },
              localizeError(t, state.errorCode),
              state.errorMessage !== null
                ? h('div', { className: 'dsh-bf-detail' }, state.errorMessage)
                : null,
            ),
          ),
          h(
            'div',
            { className: 'dsh-bf-footer' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-bf-secondary',
                title: t('dialog.close'),
                'aria-label': t('dialog.close'),
                onClick: close,
              },
              t('dialog.close'),
            ),
          ),
        ),
      )
    }

    /**
     * Resolve a localized error message for a stable code.
     * @param t - locale translate function.
     * @param code - server/client error code.
     * @returns localized text.
     */
    function localizeError(t, code) {
      if (typeof code === 'string' && KNOWN_ERRORS.has(code)) return t('error.' + code)
      return t('error.unknown')
    }

    /** Pencil icon for the card edit action. */
    function pencilIcon(size) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': true,
        },
        h('path', {
          d: 'M3 13l.6-3 7-7 2.4 2.4-7 7z',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M9.8 3.8l2.4 2.4',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      )
    }

    /** Close icon. */
    function closeIcon(size) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': true,
        },
        h('path', {
          d: 'M4 4l8 8M12 4l-8 8',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
      )
    }

    /**
     * Conversation event Definition for the edit action node.
     *
     * It matches every successful compaction end, including inherited ones.
     * The renderer hides every node except the latest card from the projection.
     */
    const editActionDefinition = {
      kind: EDIT_ACTION_KIND,
      target: 'chat',
      match: (event) => {
        if (event.type !== 'compaction/end') return null
        if (event.data?.error !== undefined) return null
        const compactionId = event.data?.compactionId
        if (typeof compactionId !== 'string' || compactionId.length === 0) return null
        return { id: compactionId, role: 'start' }
      },
      start: (_context, match) => ({
        compactionId: match.event.data.compactionId,
        endSeq: match.event.seq,
        time: match.event.time,
      }),
      update: (context, match) => ({
        ...(context.state ?? {}),
        endSeq: match.event.seq,
        time: match.event.time,
      }),
      buildViewNode: (context) => {
        const state = context.state
        if (state === undefined) return null
        return {
          key: context.key,
          kind: EDIT_ACTION_KIND,
          id: context.id,
          target: 'chat',
          anchorSeq: state.endSeq,
          location:
            context.start?.location ??
            context.matches[0]?.location ?? { kind: 'unresolved' },
          visibility: 'visible',
          data: { compactionId: state.compactionId },
        }
      },
    }

    return {
      inject: [
        'slots',
        'locale',
        'sessions',
        'uiWorkspace',
        'uiConversation',
        'remote',
        'remote.commands',
      ],
      apply(ctx) {
        const store = createEditorStore(ctx)

        ctx.effect(
          () => ctx.locale.register(NS, { en: EN, zh: ZH }),
          'better-fork: locale',
        )
        ctx.effect(
          () => ctx.uiConversation.events.register(editActionDefinition),
          'better-fork: compaction edit action',
        )
        ctx.effect(() => () => store.dispose(), 'better-fork: editor store')

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'better-fork',
              order: 500,
              locale: NS,
              inject: () => ({ startForkAndCompact: store.startForkAndCompact }),
            },
            StartSessionMenuItem,
          ),
        )

        ctx.slots.inject('conversation.chat.node', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.node',
              key: EDIT_ACTION_KIND,
              locale: NS,
              inject: () => ({
                openEditor: store.openFromCard,
                branchAtCard: store.branchAtCard,
                store,
              }),
            },
            CompactionEditAction,
          ),
        )

        ctx.slots.inject('conversation.chat.assistant-actions', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.assistant-actions',
              id: 'better-fork-start',
              order: 1000,
              locale: NS,
              inject: () => ({ startForkAtMessage: store.startForkAtMessage }),
            },
            AssistantStartAction,
          ),
        )

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'compaction-edit-dialog',
              order: 1000,
              locale: NS,
              inject: () => ({ store }),
            },
            ErrorDialog,
          ),
        )
      },
    }
  },
})
