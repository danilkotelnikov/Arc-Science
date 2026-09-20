import React from 'react';
import {expect, test} from 'vitest';
import {render, waitFor} from '@testing-library/react';
import {NATIVE_SESSION} from './http';
import {parseEventBlock, useRenderEvents} from './renderEvents';

function streamOf(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); }});
}

function Probe({fetcher, onEvent, live, token = 'operator'}) {
  const state = useRenderEvents({token, jobId: 'job-1', active: true, onEvent, fetcher, attempts: 2});
  live.current = state;
  return null;
}

test('event blocks parse with ids, multi-line data and comments ignored', () => {
  expect(parseEventBlock('id: 3\nevent: stage\ndata: {"stage":\ndata:  "rendering"}')).toEqual({id: '3', event: 'stage', data: {stage: 'rendering'}});
  expect(parseEventBlock(': keep-alive')).toBeNull();
  expect(parseEventBlock('event: end\ndata: {}')).toEqual({event: 'end', data: {}});
});

test('the stream is read with the token in a header, resumed from the last id, and ended cleanly', async () => {
  const requests = [];
  const fetcher = async (path, options) => {
    requests.push({path, headers: options.headers});
    if (requests.length === 1) {
      // The first connection breaks after one stage.
      return new Response(streamOf(['event: snapshot\ndata: {"status":"rendering"}\n\n', 'id: 0\nevent: stage\ndata: {"stage":"preparing"}\n\n', ': keep-alive\n\n']),
        {status: 200, headers: {'Content-Type': 'text/event-stream'}});
    }
    return new Response(streamOf(['id: 1\nevent: stage\ndata: {"stage":"contacts_ready"}\n\n', 'event: status\ndata: {"status":"completed"}\n\nevent: end\ndata: {}\n\n']),
      {status: 200, headers: {'Content-Type': 'text/event-stream'}});
  };
  const events = [];
  const live = {current: null};
  render(<Probe fetcher={fetcher} onEvent={e => events.push(e)} live={live}/>);
  await waitFor(() => expect(events.map(e => e.event)).toEqual(['snapshot', 'stage', 'stage', 'status', 'end']), {timeout: 4000});
  expect(requests[0].headers).toEqual({Authorization: 'Bearer operator', Accept: 'text/event-stream'});
  expect(requests[1].headers['Last-Event-ID']).toBe('0');
  expect(events[2].data.stage).toBe('contacts_ready');
  await waitFor(() => expect(live.current).toBe(false));
});

test('a refused stream gives up at once and reports the loss so polling takes over', async () => {
  const events = [];
  const live = {current: null};
  render(<Probe fetcher={async () => new Response('', {status: 404})} onEvent={e => events.push(e)} live={live}/>);
  await waitFor(() => expect(events.map(e => e.event)).toEqual(['lost']));
  expect(live.current).toBe(false);
});


test('the native session sentinel streams without an authorization header', async () => {
  const requests = [];
  const events = [];
  const live = {current: null};
  const fetcher = async (path, options) => {
    requests.push({path, headers: options.headers});
    return new Response(streamOf(['event: end\ndata: {}\n\n']), {status: 200, headers: {'Content-Type': 'text/event-stream'}});
  };
  render(<Probe fetcher={fetcher} onEvent={e => events.push(e)} live={live} token={NATIVE_SESSION}/>);
  await waitFor(() => expect(events.map(e => e.event)).toEqual(['end']));
  expect(requests[0]).toEqual({path: '/api/molecular/renders/job-1/events', headers: {Accept: 'text/event-stream'}});
});
