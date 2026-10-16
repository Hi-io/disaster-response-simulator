import { parentPort, workerData } from 'node:worker_threads';
import { evaluateSnapshot } from './evaluation-snapshot.mjs';

try {
  parentPort.postMessage({ result: evaluateSnapshot(workerData) });
} catch (error) {
  parentPort.postMessage({ error: { code: error.code ?? 'EVALUATION', message: error.message, status: error.status ?? 500 } });
}
