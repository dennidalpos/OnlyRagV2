import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { scanDependencyFiles } from './core/infrastructure/filesystem/dependencyScanFiles'

const request = z.object({ root: z.string().min(1) }).parse(workerData)
void scanDependencyFiles(request.root).then((result) => {
  parentPort?.postMessage({ result, heapUsedBytes: process.memoryUsage().heapUsed })
  parentPort?.close()
})
