import {useEffect, useRef, useState} from 'react';
import {apiFetch} from './http';

// A render's progress as it happens: the service's event stream, read with the
// shared API transport (never a native EventSource, which cannot carry credentials),
// resumed from the last id on a broken connection, and given up to polling after a
// few failures. Nothing here is a claim about the render: the stages are what the
// pipeline wrote so far, named as observations: an output appeared, not a step succeeded.
export const STAGE_LABELS = {preparing: 'pipeline started', contacts_ready: 'scene output appeared', rendering: 'render log appeared',
  composing: 'composed figure appeared', checking: 'image checks appeared', verifying: 'verifying artifacts'};

export function parseEventBlock(block) {
  const event = {};
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const key = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (key === 'data') event.data = (event.data || '') + value;
    else if (key === 'event' || key === 'id') event[key] = value;
  }
  if (!event.event) return null;
  try { event.data = event.data ? JSON.parse(event.data) : {}; } catch { event.data = {}; }
  return event;
}

export function useRenderEvents({token, jobId, active, onEvent, fetcher = globalThis.fetch, attempts = 3}) {
  const [live, setLive] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!token || !jobId || !active) { setLive(false); return undefined; }
    const controller = new AbortController();
    let lastId = null;
    (async () => {
      for (let attempt = 0; attempt < attempts && !controller.signal.aborted; attempt++) {
        try {
          const headers = {Accept: 'text/event-stream'};
          if (lastId !== null) headers['Last-Event-ID'] = lastId;
          const response = await apiFetch('/api/molecular/renders/' + jobId + '/events', {token, headers, fetcher, signal: controller.signal, cache: 'no-store', check: false});
          if ([401, 403, 404, 405].includes(response.status)) break; // the service will not stream this; poll instead
          if (!response.ok || !response.body) throw new Error('HTTP ' + response.status);
          setLive(true);
          const reader = response.body.getReader(), decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const {value, done} = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, {stream: true});
            let end;
            while ((end = buffer.indexOf('\n\n')) >= 0) {
              const event = parseEventBlock(buffer.slice(0, end));
              buffer = buffer.slice(end + 2);
              if (!event) continue;
              if (event.id !== undefined) lastId = event.id;
              handler.current?.(event);
              if (event.event === 'end') { setLive(false); return; }
            }
          }
          // The connection closed without `end`: it broke, so resume from the last id.
          setLive(false);
          throw new Error('stream closed early');
        } catch (reason) {
          if (controller.signal.aborted) return;
          setLive(false);
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
      handler.current?.({event: 'lost', data: {}});
    })();
    return () => { controller.abort(); setLive(false); };
  }, [token, jobId, active, fetcher, attempts]);
  return live;
}
