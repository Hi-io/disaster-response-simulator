import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLab } from './lab.mjs';

// API-only hosting reuses the laboratory's authoritative engine and gateways.
// The fictional social network remains a source to scrape; the 3D observer UI
// is the optional component disabled here. No browser or rendering runtime is loaded.
export async function createService({ autoPlay = false, ...options } = {}) {
  if (typeof autoPlay !== 'boolean') throw new TypeError('autoPlay must be a boolean');
  const lab = await createLab(options);
  const [observerHandler] = lab.observer.listeners('request');
  lab.observer.removeListener('request', observerHandler);
  lab.observer.on('request', (req, res) => {
    if (new URL(req.url, 'http://localhost').pathname.startsWith('/api/'))
      return observerHandler(req, res);
    res.writeHead(404, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
    res.end(
      JSON.stringify({
        error: 'VIEWER_DISABLED',
        message: 'API-only service. Use the observer or organization endpoints.',
      }),
    );
  });
  if (autoPlay) {
    try {
      const response = await fetch(`http://127.0.0.1:${lab.observerPort}/api/control`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${lab.observerKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ play: true }),
      });
      if (!response.ok) throw new Error(`Could not start the simulation: HTTP ${response.status}`);
    } catch (error) {
      await lab.close();
      throw error;
    }
  }
  return lab;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.some((arg) => arg !== '--play')) throw new Error('Supported option: --play');
  const lab = await createService({ autoPlay: args.includes('--play'), isolated: true });
  console.log(
    `Simulation service: http://127.0.0.1:${lab.observerPort}/api/\nSources: http://127.0.0.1:${lab.sourcePort}/feed\n3D viewer disabled. Credentials are in ignored .local/session.json.`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await lab.close();
      process.exit(0);
    });
}
