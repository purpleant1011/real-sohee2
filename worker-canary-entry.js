import worker from './worker-entry.js'
import { createCanaryWorker } from './scripts/canary-worker.mjs'

export default createCanaryWorker(worker)
