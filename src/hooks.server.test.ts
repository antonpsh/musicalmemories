import { describe, expect, it, vi } from 'vitest';
import { handle } from './hooks.server.ts';

function run(host: string | null) {
	const headers = new Headers(host === null ? {} : { host });
	const resolve = vi.fn(async () => new Response('ok'));
	const event = { request: new Request('http://localhost:3000/', { headers }) };
	return { response: handle({ event, resolve } as unknown as Parameters<typeof handle>[0]) as Promise<Response>, resolve };
}

describe('handle', () => {
	it.each(['localhost:3000', '127.0.0.1:3000', 'LOCALHOST:3000'])('serves Host %s', async (host) => {
		const { response, resolve } = run(host);
		expect((await response).status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it.each(['evil.example', 'evil.example:3000', 'localhost', 'localhost:3001'])('rejects Host %s (DNS rebinding)', async (host) => {
		const { response, resolve } = run(host);
		expect((await response).status).toBe(421);
		expect(resolve).not.toHaveBeenCalled();
	});
});
