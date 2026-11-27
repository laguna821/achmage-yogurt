import type { WidgetLayout } from '../shared/widgetMorph'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { capabilities, platformOf } from '../shared/platform'
import type { ChatView, ConversationSummary, ConversationView, NoteView, PromptAction, SetupState, UpdateStatus, WidgetView, YogurtApi } from '../shared/types'

const api: YogurtApi = {
  video: {
    get:id=>ipcRenderer.invoke('video:get',id),start:(id,options)=>ipcRenderer.invoke('video:start',id,options),cancel:id=>ipcRenderer.invoke('video:cancel',id),
    answer:(id,answers)=>ipcRenderer.invoke('video:answer',id,answers),frame:(id,frameId,patch)=>ipcRenderer.invoke('video:frame',id,frameId,patch),applyChanges:id=>ipcRenderer.invoke('video:apply-changes',id),
    research:(id,topic)=>ipcRenderer.invoke('video:research',id,topic),appendResearch:(id,researchId)=>ipcRenderer.invoke('video:append-research',id,researchId),copy:id=>ipcRenderer.invoke('video:copy',id),export:(id,assets)=>ipcRenderer.invoke('video:export',id,assets),
    onChange:cb=>{const on=(_e:unknown,state:Parameters<typeof cb>[0])=>cb(state);ipcRenderer.on('video:changed',on);return()=>ipcRenderer.off('video:changed',on)}
  },
  speech: {get:()=>ipcRenderer.invoke('speech:get'),select:id=>ipcRenderer.invoke('speech:select',id)},
  versions: { restore: (id,revision,expected) => ipcRenderer.invoke('versions:restore',id,revision,expected), list: id => ipcRenderer.invoke('versions:list',id), read: (id,revision) => ipcRenderer.invoke('versions:read',id,revision), candidate: id => ipcRenderer.invoke('versions:candidate',id), accept: (id,expected) => ipcRenderer.invoke('versions:accept',id,expected) },
  plaud: { status: () => ipcRenderer.invoke('plaud:status'), connect: () => ipcRenderer.invoke('plaud:connect'), disconnect: () => ipcRenderer.invoke('plaud:disconnect'), list: page => ipcRenderer.invoke('plaud:list',page), import: id => ipcRenderer.invoke('plaud:import',id), cancel: () => ipcRenderer.invoke('plaud:cancel') },
  imports: { dismiss: id => ipcRenderer.invoke('imports:dismiss', id), dismissFinished: () => ipcRenderer.invoke('imports:dismiss-finished'), info: id => ipcRenderer.invoke('imports:info',id), pick: () => ipcRenderer.invoke('imports:pick'), describe: paths => ipcRenderer.invoke('imports:describe', paths), filePath: file => webUtils.getPathForFile(file), start: request => ipcRenderer.invoke('imports:start', request), list: () => ipcRenderer.invoke('imports:list'), cancel: id => ipcRenderer.invoke('imports:cancel', id), retry: id => ipcRenderer.invoke('imports:retry', id), tools: () => ipcRenderer.invoke('imports:tools'), onChange: cb => { const fn = (_e: unknown, jobs: import('../shared/imports').ImportJob[]) => cb(jobs); ipcRenderer.on('imports:changed', fn); return () => { ipcRenderer.removeListener('imports:changed', fn) } } },
  appearance: { get: () => ipcRenderer.invoke('appearance:get'), set: patch => ipcRenderer.invoke('appearance:set', patch), onChange: cb => { const fn = (_e: unknown, s: import('../shared/appearance').Appearance) => cb(s); ipcRenderer.on('appearance:changed', fn); return () => { ipcRenderer.removeListener('appearance:changed', fn) } } },
  organizer: {
    vault: {get:()=>ipcRenderer.invoke('sources:vault'),choose:()=>ipcRenderer.invoke('sources:choose-vault'),clear:()=>ipcRenderer.invoke('sources:clear-vault')},
    get: id => ipcRenderer.invoke('organizer:get', id),
    configure: (id, options, context) => ipcRenderer.invoke('organizer:configure', id, options, context),
    attach: id => ipcRenderer.invoke('organizer:attach', id),
    attachBytes: (id, files) => ipcRenderer.invoke('organizer:attach-bytes', id, files),
    pasteImage: id => ipcRenderer.invoke('organizer:paste-image', id),
    remove: (id, evidenceId) => ipcRenderer.invoke('organizer:remove', id, evidenceId),
    start: id => ipcRenderer.invoke('organizer:start', id),
    answer: (id, answers, defaults) => ipcRenderer.invoke('organizer:answer', id, answers, defaults),
    openWork: id => ipcRenderer.invoke('organizer:open-work', id),
    mailSearch: (id, query) => ipcRenderer.invoke('organizer:mail-search', id, query),
    onChange: cb => { const on = (_e: unknown, state: import('../shared/organizer').OrganizerState) => cb(state); ipcRenderer.on('organizer:changed', on); return () => { ipcRenderer.removeListener('organizer:changed', on) } },
    gmail: {status: () => ipcRenderer.invoke('gmail:status'), importClient: () => ipcRenderer.invoke('gmail:import-client'), connect: () => ipcRenderer.invoke('gmail:connect'), disconnect: () => ipcRenderer.invoke('gmail:disconnect'), guide: () => ipcRenderer.invoke('gmail:guide')},
  },
  subscription: {
    connect: () => ipcRenderer.invoke('subscription:connect'),
    status: () => ipcRenderer.invoke('subscription:status'),
    apply: (model, effort) => ipcRenderer.invoke('subscription:apply', model, effort),
    test: () => ipcRenderer.invoke('subscription:test'),
    removeLocal: () => ipcRenderer.invoke('subscription:remove-local'),
  },
  platform: process.platform,
  os: platformOf(process.platform, process.env),
  capabilities: capabilities(platformOf(process.platform, process.env)),
  fake: process.env.YOGURT_FAKE === '1',
  setup: {
    state: () => ipcRenderer.invoke('setup:state'),
    onState: (cb) => {
      const on = (_e: unknown, s: SetupState) => cb(s)
      ipcRenderer.on('setup:state', on)
      return () => { ipcRenderer.removeListener('setup:state', on) }
    },
    retry: () => ipcRenderer.invoke('setup:retry'),
    skipUpgrade: () => ipcRenderer.invoke('setup:skip-upgrade'),
    downloadUpgrade: () => ipcRenderer.invoke('setup:download-upgrade'),
    removeUpgrade: () => ipcRenderer.invoke('setup:remove-upgrade'),
  },
  prompt: {
    state: () => ipcRenderer.invoke('prompt:state'),
    act: (a: PromptAction) => { void ipcRenderer.invoke('prompt:act', a) },
  },
  widget: {
    state: () => ipcRenderer.invoke('widget:state'),
    onState: (cb) => {
      const on = (_e: unknown, v: WidgetView | null) => cb(v)
      ipcRenderer.on('widget:state', on)
      return () => { ipcRenderer.removeListener('widget:state', on) }
    },
    onLevel: (cb) => {
      const on = (_e: unknown, lv: { me: number; them: number }) => cb(lv)
      ipcRenderer.on('widget:level', on)
      return () => { ipcRenderer.removeListener('widget:level', on) }
    },
    open: () => { ipcRenderer.send('widget:open') },
    stop: () => { ipcRenderer.send('widget:stop') },
    layout: () => ipcRenderer.invoke('widget:layout'),
    onLayout: (cb) => {
      const on = (_e: unknown, layout: WidgetLayout) => cb(layout)
      ipcRenderer.on('widget:layout', on)
      return () => { ipcRenderer.removeListener('widget:layout', on) }
    },
    onPointer: (cb) => {
      const on = (_e: unknown, point: { x: number; y: number }) => cb(point)
      ipcRenderer.on('widget:pointer', on)
      return () => { ipcRenderer.removeListener('widget:pointer', on) }
    },
    onReset: (cb) => {
      ipcRenderer.on('widget:reset', cb)
      return () => { ipcRenderer.removeListener('widget:reset', cb) }
    },
    surface: (rect) => { ipcRenderer.send('widget:surface', rect) },
    pressed: (value) => { ipcRenderer.send('widget:pressed', value) },
    drag: (dx, dy) => { ipcRenderer.send('widget:drag', dx, dy) },
    endDrag: () => { ipcRenderer.send('widget:drag-end') },
    size: (w, h) => { ipcRenderer.send('widget:size', w, h) },
  },
  meetings: {
    takeRecordingReminder: () => ipcRenderer.invoke('meetings:take-recording-reminder'),
    get: (id) => ipcRenderer.invoke('meetings:get', id),
    cards: (o) => ipcRenderer.invoke('meetings:cards', o),
    start: (eventId) => ipcRenderer.invoke('meetings:start', eventId),
    prepare: (eventId, day) => ipcRenderer.invoke('meetings:prepare', eventId, day),
    startPrepared: (id) => ipcRenderer.invoke('meetings:start-prepared', id),
    resume: (id) => ipcRenderer.invoke('meetings:resume', id),
    stop: (id) => { ipcRenderer.send('meetings:stop', id) },
    setPaused: (id, paused) => ipcRenderer.invoke('meetings:set-paused', id, paused),
    retryStopSave: (id) => ipcRenderer.invoke('meetings:retry-stop-save', id),
    rename: (id, title) => ipcRenderer.invoke('meetings:rename', id, title),
    delete: (id) => ipcRenderer.invoke('meetings:delete', id),
    trash: (id) => ipcRenderer.invoke('meetings:trash', id),
    restore: (id) => ipcRenderer.invoke('meetings:restore', id),
    trashed: () => ipcRenderer.invoke('meetings:trashed'),
    emptyTrash: () => ipcRenderer.invoke('meetings:empty-trash'),
    renameAttendee: (id, index, name, expected) => ipcRenderer.invoke('meetings:rename-attendee', id, index, name, expected),
    setAttendees: (id, people) => ipcRenderer.invoke('meetings:set-attendees', id, people),
    linkEvent: (id, eventId, day) => ipcRenderer.invoke('meetings:link-event', id, eventId, day),
    onChange: (cb) => {
      const on = () => cb()
      ipcRenderer.on('meetings:changed', on)
      return () => { ipcRenderer.removeListener('meetings:changed', on) }
    },
  },
  transcript: {
    get: (id, o) => ipcRenderer.invoke('transcript:get', id, o),
    restore: (id, ids) => ipcRenderer.invoke('transcript:restore', id, ids),
    onSegment: (cb) => {
      const on = (_e: unknown, seg: Parameters<typeof cb>[0]) => cb(seg)
      ipcRenderer.on('transcript:segment', on)
      return () => { ipcRenderer.removeListener('transcript:segment', on) }
    },
    onSpeakers: (cb) => {
      const on = (_e: unknown, id: string) => cb(id)
      ipcRenderer.on('transcript:speakers', on)
      return () => { ipcRenderer.removeListener('transcript:speakers', on) }
    },
    onPartial: (cb) => {
      const on = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
      ipcRenderer.on('transcript:partial', on)
      ipcRenderer.send('transcript:subscribe')
      return () => { ipcRenderer.removeListener('transcript:partial', on) }
    },
  },
  notes: {
    get: (id) => ipcRenderer.invoke('notes:get', id),
    setMine: (id, md, revision) => ipcRenderer.invoke('notes:set-mine', id, md, revision),
    setEnhanced: (id, md, revision) => ipcRenderer.invoke('notes:set-enhanced', id, md, revision),
    flushSync: (id, side, md, revision) => ipcRenderer.sendSync('notes:flush-sync', id, side, md, revision),
    onFlushRequest: (cb) => {
      const run = (_e: unknown, token: number | null) => {
        void cb(token !== null).then((saved) => { if (token !== null) ipcRenderer.send('notes:flushed', token, saved) }, () => { if (token !== null) ipcRenderer.send('notes:flushed', token, false) })
      }
      ipcRenderer.on('notes:flush-request', run)
      return () => { ipcRenderer.removeListener('notes:flush-request', run) }
    },
    keptEdits: (id) => { ipcRenderer.send('notes:kept-edits', id) },
    writeAgain: (id) => ipcRenderer.invoke('notes:write-again', id),
    onChange: (cb) => {
      const on = (_e: unknown, v: NoteView) => cb(v)
      ipcRenderer.on('notes:changed', on)
      return () => { ipcRenderer.removeListener('notes:changed', on) }
    },
  },
  share: {
    copy: (id, what, side) => ipcRenderer.invoke('share:copy', id, what, side),
    save: (id, side) => ipcRenderer.invoke('share:save', id, side),
  },
  audio: {
    delete: (id) => ipcRenderer.invoke('audio:delete', id),
    onDeleted: (cb) => {
      const on = (_e: Electron.IpcRendererEvent, id: string) => cb(id)
      ipcRenderer.on('audio:deleted', on)
      return () => { ipcRenderer.removeListener('audio:deleted', on) }
    },
    tracks: (id) => ipcRenderer.invoke('audio:tracks', id),
    mics: () => ipcRenderer.invoke('audio:mics'),
    setMic: (id) => ipcRenderer.invoke('audio:set-mic', id),
    onMics: (fn) => {
      const on = (_e: unknown, v: { fellBack: boolean }) => fn(v)
      ipcRenderer.on('audio:mics-changed', on)
      return () => { ipcRenderer.removeListener('audio:mics-changed', on) }
    },
  },
  chat: {
    get: (id) => ipcRenderer.invoke('chat:get', id),
    ask: (id, q) => ipcRenderer.invoke('chat:ask', id, q),
    stop: (id) => { ipcRenderer.send('chat:stop', id) },
    clear: (id) => ipcRenderer.invoke('chat:clear', id),
    onChange: (cb) => {
      const on = (_e: unknown, v: ChatView) => cb(v)
      ipcRenderer.on('chat:changed', on)
      return () => { ipcRenderer.removeListener('chat:changed', on) }
    },
  },
  conversations: {
    current: (chips, fresh) => ipcRenderer.invoke('conversations:current', chips, fresh),
    context: (id, chips) => ipcRenderer.invoke('conversations:context', id, chips),
    removeContext: (id, chip) => ipcRenderer.invoke('conversations:remove-context', id, chip),
    draft: (id, text) => ipcRenderer.invoke('conversations:draft', id, text),
    targets: (query) => ipcRenderer.invoke('conversations:targets', query),
    list: () => ipcRenderer.invoke('conversations:list'),
    get: (id) => ipcRenderer.invoke('conversations:get', id),
    ask: (id, q) => ipcRenderer.invoke('conversations:ask', id, q),
    stop: (id) => { ipcRenderer.send('conversations:stop', id) },
    warm: (id) => { ipcRenderer.send('conversations:warm', id) },
    rename: (id, title) => ipcRenderer.invoke('conversations:rename', id, title),
    delete: (id) => ipcRenderer.invoke('conversations:delete', id),
    onChange: (cb) => {
      const on = (_e: unknown, v: ConversationView) => cb(v)
      ipcRenderer.on('conversations:changed', on)
      return () => { ipcRenderer.removeListener('conversations:changed', on) }
    },
    onList: (cb) => {
      const on = (_e: unknown, l: ConversationSummary[]) => cb(l)
      ipcRenderer.on('conversations:list', on)
      return () => { ipcRenderer.removeListener('conversations:list', on) }
    },
  },
  calendar: {
    list: () => ipcRenderer.invoke('calendar:list'),
    setEnabled: (id, enabled) => ipcRenderer.invoke('calendar:set-enabled', id, enabled),
    setHideWithoutLink: (hide) => ipcRenderer.invoke('calendar:set-hide-without-link', hide),
    onChange: (cb) => { ipcRenderer.on('calendar:changed', cb); return () => { ipcRenderer.off('calendar:changed', cb) } },
    comingUp: () => ipcRenderer.invoke('calendar:coming-up'),
    connect: () => ipcRenderer.invoke('calendar:connect'),
    day: (at) => ipcRenderer.invoke('calendar:day', at),
  },
  permissions: {
    status: () => ipcRenderer.invoke('permissions:status'),
    request: (k) => ipcRenderer.invoke('permissions:request', k),
    open: (k) => ipcRenderer.invoke('permissions:open', k),
    relaunch: () => ipcRenderer.invoke('permissions:relaunch'),
  },
  onboarding: {
    plan: () => ipcRenderer.invoke('onboarding:plan'),
    introSeen: () => ipcRenderer.invoke('onboarding:intro-seen'),
    done: () => ipcRenderer.invoke('onboarding:done'),
    nudge: () => ipcRenderer.invoke('onboarding:nudge'),
    dismissNudge: () => ipcRenderer.invoke('onboarding:dismiss-nudge'),
    restoreNudge: () => ipcRenderer.invoke('onboarding:restore-nudge'),
  },
  mcp: {
    status: () => ipcRenderer.invoke('mcp:status'),
    set: (on) => ipcRenderer.invoke('mcp:set', on),
    onClients: (fn) => { const f = (_e: unknown, c: string[]) => fn(c); ipcRenderer.on('mcp:clients', f); return () => { ipcRenderer.off('mcp:clients', f) } },
  },
  updates: {
    status: () => ipcRenderer.invoke('updates:status'),
    set: (on) => ipcRenderer.invoke('updates:set', on),
    check: () => ipcRenderer.invoke('updates:check'),
    restart: () => ipcRenderer.invoke('updates:restart'),
    later: () => ipcRenderer.invoke('updates:later'),
    onStatus: (fn) => { const f = (_e: unknown, s: UpdateStatus) => fn(s); ipcRenderer.on('updates:status', f); return () => { ipcRenderer.off('updates:status', f) } },
  },
  backup: {
    status: () => ipcRenderer.invoke('backup:status'),
    export: () => ipcRenderer.invoke('backup:export'),
    import: () => ipcRenderer.invoke('backup:import'),
    show: () => { ipcRenderer.send('backup:show') },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setTheme: (v) => ipcRenderer.invoke('settings:theme', v),
    setShowInMenuBar: (on) => ipcRenderer.invoke('settings:menu-bar', on),
    setAppVisibility: (choice) => ipcRenderer.invoke('settings:visibility', choice),
    setOpenAtLogin: (on) => ipcRenderer.invoke('settings:login', on),
    setName: (name) => ipcRenderer.invoke('settings:name', name),
    setStopWhenCallEnds: (on) => ipcRenderer.invoke('settings:auto-stop', on),
    setRecordingReminder: (on) => ipcRenderer.invoke('settings:recording-reminder', on),
    setKeepRecordings: (on) => ipcRenderer.invoke('settings:keep-recordings', on),
    setJargon: (terms) => ipcRenderer.invoke('settings:jargon', terms),
    setLanguage: (id) => ipcRenderer.invoke('settings:language', id),
    setSummaryLanguage: (id) => ipcRenderer.invoke('settings:summary-language', id),
    onLanguage: (cb) => { const f = (_e: unknown, locale: string) => cb(locale); ipcRenderer.on('settings:language', f); return () => { ipcRenderer.off('settings:language', f) } },
    setSpoken: (v) => ipcRenderer.invoke('settings:spoken', v),
  },
  search: { query: (q, folder, people) => ipcRenderer.invoke('search:query', q, folder, people), people: () => ipcRenderer.invoke('search:people') },
  folders: {
    suggestion: (id) => ipcRenderer.invoke('folders:suggestion', id),
    dismissSuggestion: (id) => ipcRenderer.invoke('folders:dismiss-suggestion', id),
    list: () => ipcRenderer.invoke('folders:list'),
    reorder: (ids) => ipcRenderer.invoke('folders:reorder', ids),
    of: (meetingId) => ipcRenderer.invoke('folders:of', meetingId),
    create: (name, appearance) => ipcRenderer.invoke('folders:create', name, appearance),
    appearance: (id, appearance) => ipcRenderer.invoke('folders:appearance', id, appearance),
    rename: (id, name) => ipcRenderer.invoke('folders:rename', id, name),
    delete: (id) => ipcRenderer.invoke('folders:delete', id),
    add: (id, meetingId) => ipcRenderer.invoke('folders:add', id, meetingId),
    remove: (id, meetingId) => ipcRenderer.invoke('folders:remove', id, meetingId),
    onChange: (cb) => {
      const on = () => cb()
      ipcRenderer.on('folders:changed', on)
      return () => { ipcRenderer.removeListener('folders:changed', on) }
    },
  },
  sidebar: {
    setOpen: (open) => { ipcRenderer.send('sidebar:state', open) },
    onToggle: (cb) => {
      const on = () => cb()
      ipcRenderer.on('sidebar:toggle', on)
      return () => { ipcRenderer.removeListener('sidebar:toggle', on) }
    },
  },
  nav: {
    takeAsk: () => ipcRenderer.invoke('nav:take-ask'),
    onAsk: (cb) => { const fn = () => cb(); ipcRenderer.on('nav:ask', fn); return () => { ipcRenderer.off('nav:ask', fn) } },
    go: (r) => { ipcRenderer.send('nav:go', r) },
    current: () => ipcRenderer.invoke('nav:current'),
    onGo: (cb) => {
      const on = (_e: unknown, r: string, resumeRequested?: boolean) => cb(r, resumeRequested)
      ipcRenderer.on('nav:go', on)
      return () => { ipcRenderer.removeListener('nav:go', on) }
    },
  },
}
contextBridge.exposeInMainWorld('yogurt', api)
