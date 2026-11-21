import { ipcMain, dialog, clipboard, safeStorage, shell } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Organizer } from './index'
import { GmailConnector } from './gmail'
import { importMaterial } from './runtime'
import type { OrganizerOptions, OrganizerContext } from '../../shared/organizer'

export function createOrganizerHost(profile: string, skillDir: string, known: (id: unknown) => id is string, changed: ConstructorParameters<typeof Organizer>[2]) {
  const gmail = new GmailConnector(join(profile, 'gmail'), {
    encode: text => safeStorage.isEncryptionAvailable() ? Buffer.concat([Buffer.from([1]), safeStorage.encryptString(text)]) : Buffer.concat([Buffer.from([0]), Buffer.from(text)]),
    decode: bytes => bytes[0] === 1 ? safeStorage.decryptString(bytes.subarray(1)) : bytes.subarray(1).toString(),
  })
  const organizer = new Organizer(join(profile, 'organizer'), skillDir, changed, gmail)
  const check = (id: unknown) => { if (!known(id)) throw new Error('기록을 찾지 못했습니다.'); return id }
  const importPaths = async (id: string, paths: string[]) => {
    const materials = []
    for (const path of paths.slice(0, 12)) materials.push(await importMaterial(path, randomUUID()))
    return organizer.attach(id, materials)
  }
  ipcMain.handle('organizer:get', (_e, id: unknown) => organizer.get(check(id)))
  ipcMain.handle('organizer:configure', (_e, id: unknown, options: OrganizerOptions, context: OrganizerContext) => organizer.configure(check(id), options, context))
  ipcMain.handle('organizer:attach', async (_e, id: unknown) => {
    check(id)
    const result = await dialog.showOpenDialog({ title: '전사 정리에 참고할 자료', properties: ['openFile', 'multiSelections'], filters: [{ name: '문서·대화·이미지', extensions: ['pdf', 'docx', 'txt', 'md', 'json', 'csv', 'html', 'eml', 'png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
    return result.canceled ? organizer.get(check(id)) : importPaths(check(id), result.filePaths)
  })
  ipcMain.handle('organizer:attach-bytes', async (_e, id: unknown, files: unknown) => {
    check(id); if (!Array.isArray(files) || files.length > 12) throw new Error('첨부 파일을 확인하세요.')
    const temp = join(profile, 'organizer-upload', randomUUID()); mkdirSync(temp, { recursive: true, mode: 0o700 })
    try {
      const paths = []
      for (const f of files) {
        if (typeof f?.name !== 'string' || typeof f?.data !== 'string' || f.data.length > 28_000_000 || !/\.(pdf|docx|txt|md|json|csv|html|eml|png|jpg|jpeg|webp|gif)$/i.test(f.name)) throw new Error('지원하는 파일과 20MB 제한을 확인하세요.')
        const p = join(temp, `${paths.length}-${basename(f.name)}`); writeFileSync(p, Buffer.from(f.data, 'base64'), { mode: 0o600 }); paths.push(p)
      }
      return await importPaths(check(id), paths)
    } finally { rmSync(temp, { recursive: true, force: true }) }
  })
  ipcMain.handle('organizer:paste-image', async (_e, id: unknown) => {
    check(id); const items = await clipboard.read(); const item = items.find(i => i.types.includes('image/png')); if (!item) throw new Error('클립보드에 PNG 이미지가 없습니다. 파일 첨부를 이용하세요.'); const blob = await item.getType('image/png'); const image = Buffer.from(await blob.arrayBuffer()); if (image.length > 20_000_000) throw new Error('이미지는 20MB까지 첨부할 수 있습니다.')
    const temp = join(profile, 'organizer-upload', randomUUID()); mkdirSync(temp, { recursive: true, mode: 0o700 }); const p = join(temp, '클립보드 이미지.png')
    try { writeFileSync(p, image, { mode: 0o600 }); return await importPaths(check(id), [p]) } finally { rmSync(temp, { recursive: true, force: true }) }
  })
  ipcMain.handle('organizer:remove', (_e, id: unknown, evidenceId: unknown) => { if (typeof evidenceId !== 'string') throw new Error('자료를 확인하세요.'); return organizer.removeAttachment(check(id), evidenceId) })
  ipcMain.handle('organizer:open-work', (_e, id: unknown) => shell.openPath(join(profile, 'organizer', check(id))))
  ipcMain.handle('gmail:status', () => gmail.status())
  ipcMain.handle('gmail:import-client', async () => {
    const result = await dialog.showOpenDialog({ title: 'Google Desktop OAuth 클라이언트 등록', properties: ['openFile'], filters: [{ name: 'Google OAuth 클라이언트', extensions: ['json'] }] })
    if (!result.canceled) gmail.configure(JSON.parse(readFileSync(result.filePaths[0], 'utf8')))
    return gmail.status()
  })
  ipcMain.handle('gmail:connect', () => gmail.connect(url => shell.openExternal(url)))
  ipcMain.handle('gmail:disconnect', () => gmail.disconnect())
  ipcMain.handle('gmail:guide', () => shell.openExternal('https://developers.google.com/identity/protocols/oauth2/native-app'))
  ipcMain.handle('organizer:mail-search', async (_e, id: unknown, query: unknown) => {
    check(id); if (typeof query !== 'string') throw new Error('메일 검색어를 입력하세요.')
    return organizer.attach(check(id), await gmail.search(query))
  })
  return { organizer, gmail }
}
