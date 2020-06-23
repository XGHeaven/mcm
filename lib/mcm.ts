import "./prepare.ts";

import { SyncQueue } from './sync-queue.ts'
import { colors } from './deps.ts'
import { StorageManager } from './storage.ts'
import { MinecraftExecutor } from './executor/mc.ts'
import { FabricExecutor } from './executor/fabric.ts'

const args = Deno.args.slice(0)

if (args[0] === '--help' || args[0] === '-h') {
  const version = colors.yellow('<version>')
  console.log('mcm [options] <...commands>')
  console.log()
  console.log('Available Command:')
  console.log(`  mc:${version}\tsync minecraft of ${version}`)
  console.log(`  fabric:${version}\tsync fabric of ${version}`)
  console.log()
  console.log(`  ${version} is one of follow`)
  console.log(`    - ${colors.cyan('1.16-rc1')} ${colors.cyan('1.15.2')} normal version`)
  console.log(`    - ${colors.cyan('/^1\\.16.*$/')} regexp version`)
  Deno.exit(0)
}

const commands: string[] = []

while(args.length > 0) {
  const v = args[0]
  switch(v) {
    default:
      // command
      commands.push(v)
  }
  args.shift()
}

if (!commands.length) {
  console.error('Please give a command')
  Deno.exit(0)
}

const syncQueue = new SyncQueue()
const storage = StorageManager.create()
const mc = new MinecraftExecutor(storage)
const fabric = new FabricExecutor(storage)

for (const command of commands) {
  const [type, versionString] = command.split(':')
  if (!type || !versionString) {
    console.warn(`command ${colors.cyan(command)} is invalid`)
    continue
  }
  const version = versionString.startsWith('/') && versionString.endsWith('/') ? new RegExp(versionString.slice(1, -1)) : versionString
  switch(type) {
    case 'mc':
      syncQueue.queue('minecraft', mc.createMinecraftVersion(version))
      break
    case 'fabric':
      syncQueue.queue('fabric', fabric.createVersions(version))
      break
  }
}
