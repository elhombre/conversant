import { access, copyFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'

const ENGINE_FILE = 'libquery_engine-rhel-openssl-3.0.x.so.node'
const ROOT_DIR = process.cwd()
const DEST_DIR = path.join(ROOT_DIR, 'apps/frontend/.next/server/chunks')

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function findEngineInUnplugged() {
  const baseDir = path.join(ROOT_DIR, '.yarn/unplugged')
  if (!(await exists(baseDir))) {
    return null
  }

  const stack = [baseDir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      if (entry.isFile() && entry.name === ENGINE_FILE && fullPath.includes('/@prisma/engines/')) {
        return fullPath
      }
    }
  }

  return null
}

async function resolveEnginePath() {
  const generatedEngine = path.join(ROOT_DIR, 'packages/backend-data/src/generated/prisma', ENGINE_FILE)
  if (await exists(generatedEngine)) {
    return generatedEngine
  }

  return findEngineInUnplugged()
}

async function main() {
  const enginePath = await resolveEnginePath()
  if (!enginePath) {
    console.error(`Prisma Linux query engine not found: ${ENGINE_FILE}`)
    process.exit(1)
  }

  await mkdir(DEST_DIR, { recursive: true })
  const destination = path.join(DEST_DIR, ENGINE_FILE)
  await copyFile(enginePath, destination)
  console.log(`Copied Prisma engine to ${destination}`)
}

await main()
