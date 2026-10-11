import { describe, expect, it } from 'vitest';
import { errorPage } from './error-page.ts';

describe('errorPage', () => {
	it('escapes the message and sets status and headers', async () => {
		const response = errorPage(502, '<script>x</script> & "q"');
		const html = await response.text();

		expect(response.status).toBe(502);
		expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('&amp;');
		expect(html).toContain('&quot;');
		expect(html).not.toContain('<script>');
		expect(html).toContain('href="/"');
	});
});
