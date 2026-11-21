import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import asar from '@electron/asar'

const [runtimeArg, outputArg] = process.argv.slice(2)
if (!runtimeArg || !outputArg) throw new Error('Usage: package-subscription.mjs upstream-AppDir new-output-AppDir')
const runtime = resolve(runtimeArg), output = resolve(outputArg)
const built = resolve(fileURLToPath(new URL('../out', import.meta.url)))
if (existsSync(output)) throw new Error('Output already exists; refusing to replace it')
if (!existsSync(join(runtime, 'resources/app.asar')) || !existsSync(join(built, 'main/index.js'))) throw new Error('Verified runtime and built app are required')
cpSync(runtime, output, { recursive: true })
cpSync(resolve(fileURLToPath(new URL('../resources/achmage-transcript', import.meta.url))), join(output, 'resources/achmage-transcript'), { recursive: true })
const unpacked = join(output, '.subscription-package')
mkdirSync(unpacked)
asar.extractAll(join(output, 'resources/app.asar'), unpacked)
rmSync(join(unpacked, 'out'), { recursive: true }); cpSync(built, join(unpacked, 'out'), { recursive: true })
for (const p of ['node_modules/node-llama-cpp', 'node_modules/@node-llama-cpp']) rmSync(join(unpacked, p), { recursive: true, force: true })
rmSync(join(output, 'resources/app.asar.unpacked'), { recursive: true, force: true })
const pkgPath = join(unpacked, 'package.json'), pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = '0.3.38-achmage.6'; delete pkg.dependencies['node-llama-cpp']
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
await asar.createPackage(unpacked, join(output, 'resources/app.asar'))
rmSync(unpacked, { recursive: true })
console.log(output)
