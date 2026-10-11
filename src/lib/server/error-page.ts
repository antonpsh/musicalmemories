const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** A minimal HTML error page with `message` and a link back to the home page. */
export function errorPage(status: number, message: string): Response {
	const body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>musicalimage – error ${status}</title></head>
<body style="max-width:40rem;margin:4rem auto;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.5">
<h1>Something went wrong</h1>
<p>${escapeHtml(message)}</p>
<p><a href="/">Back to musicalimage</a></p>
</body>
</html>
`;
	return new Response(body, {
		status,
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
	});
}
