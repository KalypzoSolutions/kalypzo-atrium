/**
 * `FormData` als echten multipart-Body kodieren – so, wie ihn ein Browser schickt (Bytes + Content-Type mit Boundary).
 *
 * Warum nicht einfach `new Request(url, { body: formData })`? Unter Bun (Stand 1.4.4) verliert ein so gebauter Request
 * beim direkten `request.formData()` den Dateityp (`file.type === ''`), und `new Response(formData).headers` enthält
 * keinen Content-Type. Echte HTTP-Requests sind nicht betroffen (Bun parst rohe multipart-Bodies korrekt) – nur Tests,
 * die Requests im Prozess bauen. Die Boundary wird deshalb aus der ersten Zeile des kodierten Bodys gelesen.
 */
export async function encodeMultipart(
	form: FormData
): Promise<{ body: Uint8Array<ArrayBuffer>; contentType: string }> {
	const body = new Uint8Array(await new Response(form).arrayBuffer());
	const firstLine = new TextDecoder().decode(body.subarray(0, 200)).split('\r\n')[0] ?? '';
	if (!firstLine.startsWith('--')) throw new Error('multipart-Kodierung ohne Boundary');
	// Leeres Formular: nur die Schlusszeile `--<boundary>--`
	const boundary = firstLine.slice(2).replace(/--$/, '');
	return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** POST-Request mit kodiertem multipart-Body; `content-length` wie im Browser, abschaltbar/überschreibbar. */
export async function multipartRequest(
	url: string | URL,
	form: FormData,
	opts: { headers?: Record<string, string>; contentLength?: string | false } = {}
): Promise<Request> {
	const { body, contentType } = await encodeMultipart(form);
	const headers = new Headers({ 'content-type': contentType, ...opts.headers });
	if (opts.contentLength !== false)
		headers.set('content-length', opts.contentLength ?? String(body.byteLength));
	return new Request(url, { method: 'POST', headers, body });
}
