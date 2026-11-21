/** Keep domain requests on the Python service when rendered by the DSH host. */
export async function nativeFetch(path, init = {}) {
  const bridge = globalThis.window?.somnusApi;
  if (!bridge?.request) return fetch(path, init);
  if (typeof path !== 'string' || !path.startsWith('/api/') || path.startsWith('//')) {
    throw new Error('Invalid domain API path');
  }
  init.signal?.throwIfAborted();
  const headers = new Headers(init.headers);
  let body = init.body;
  if (body instanceof Blob) body = await body.arrayBuffer();
  if (body instanceof FormData) {
    const encoded = new Response(body);
    headers.set('Content-Type', encoded.headers.get('Content-Type'));
    body = await encoded.arrayBuffer();
  }
  init.signal?.throwIfAborted();
  const reply = await bridge.request(path, { method: init.method || 'GET', headers: Object.fromEntries(headers), body });
  init.signal?.throwIfAborted();
  return new Response(reply.status === 204 || reply.status === 205 || reply.status === 304 ? null : reply.body, {
    status: reply.status, headers: reply.headers,
  });
}
