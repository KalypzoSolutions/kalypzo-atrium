import { getLocale } from '$lib/i18n';
import type { JsonSchema } from '$lib/api-docs/types';
import { buildOpenApiDocument } from '../openapi';
import { allEndpoints } from '../registry';

/**
 * JSON-Schemas je Endpunkt für die API-Übersicht. Quelle ist das OpenAPI-Dokument
 * (`buildOpenApiDocument`), `$ref` werden aufgelöst, damit der Client ohne Komponenten auskommt.
 */

export interface EndpointSchemas {
	params: JsonSchema | null;
	query: JsonSchema | null;
	body: JsonSchema | null;
	response: JsonSchema | null;
}

type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;
type Json = Record<string, unknown>;

/** Maximale Verschachtelungstiefe beim Auflösen (Schutz vor sehr tiefen Schemas) */
const MAX_DEPTH = 24;
const REF_PREFIX = '#/components/schemas/';

let cache: { key: string; doc: OpenApiDocument } | null = null;

/** Dokument je Prozess cachen; neu bauen, sobald sich die Anzahl der Endpunkte oder die Sprache ändert. */
function getDocument(count: number): OpenApiDocument {
	const key = `${count}:${getLocale()}`;
	if (!cache || cache.key !== key) cache = { key, doc: buildOpenApiDocument() };
	return cache.doc;
}

export function resetSchemaCacheForTests(): void {
	cache = null;
}

function isObject(v: unknown): v is Json {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toOpenApiPath(path: string): string {
	return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** Löst `$ref` rekursiv auf; Zyklen und zu tiefe Strukturen werden zu `{ title }`. */
function resolve(value: unknown, components: Json, stack: string[], depth: number): unknown {
	if (Array.isArray(value)) return value.map((v) => resolve(v, components, stack, depth + 1));
	if (!isObject(value)) return value;
	if (depth > MAX_DEPTH) return { title: 'Zu tief verschachtelt' };

	const ref = value.$ref;
	if (typeof ref === 'string') {
		const { $ref: _ignored, ...siblings } = value;
		void _ignored;
		const name = ref.startsWith(REF_PREFIX) ? ref.slice(REF_PREFIX.length) : null;
		const target = name !== null ? components[name] : undefined;
		if (name === null || !isObject(target)) return { title: name ?? ref, ...siblings };
		if (stack.includes(name)) return { title: name };
		const resolved = resolve(target, components, [...stack, name], depth + 1) as Json;
		const extra = resolve(siblings, components, stack, depth + 1) as Json;
		return { ...resolved, ...extra };
	}

	const out: Json = {};
	for (const [k, v] of Object.entries(value)) out[k] = resolve(v, components, stack, depth + 1);
	return out;
}

/** Leeres oder nicht beschriebenes Schema (z. B. `z.unknown()` → `{}`) */
function isEmptySchema(s: JsonSchema): boolean {
	if (s.type !== undefined) return false;
	return !['properties', 'items', 'anyOf', 'oneOf', 'allOf', 'enum', 'const'].some(
		(k) => s[k] !== undefined
	);
}

function parametersSchema(
	parameters: unknown[],
	location: 'path' | 'query',
	components: Json
): JsonSchema | null {
	const properties: Record<string, JsonSchema> = {};
	const required: string[] = [];
	for (const raw of parameters) {
		const p = resolve(raw, components, [], 0);
		if (!isObject(p) || p.in !== location || typeof p.name !== 'string') continue;
		const schema: JsonSchema = isObject(p.schema) ? { ...(p.schema as JsonSchema) } : {};
		if (typeof p.description === 'string' && schema.description === undefined) {
			schema.description = p.description;
		}
		properties[p.name] = schema;
		if (p.required === true) required.push(p.name);
	}
	if (Object.keys(properties).length === 0) return null;
	return { type: 'object', properties, required };
}

/**
 * Schemas eines Endpunkts (Pfad mit `:name`); fehlt die Operation, ist alles null.
 * `endpointCount` (Cache-Schlüssel) kann der Aufrufer mitgeben, um `allEndpoints()` je Endpunkt zu sparen.
 */
export function getEndpointSchemas(
	method: string,
	fullPath: string,
	endpointCount: number = allEndpoints().length
): EndpointSchemas {
	const empty: EndpointSchemas = { params: null, query: null, body: null, response: null };
	let doc: OpenApiDocument;
	try {
		doc = getDocument(endpointCount);
	} catch {
		return empty;
	}
	const pathItem = (doc.paths as Json | undefined)?.[toOpenApiPath(fullPath)];
	const operation = isObject(pathItem) ? pathItem[method.toLowerCase()] : undefined;
	if (!isObject(operation)) return empty;

	const components = isObject(doc.components?.schemas) ? (doc.components.schemas as Json) : {};
	const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];

	let body: JsonSchema | null = null;
	const requestBody = resolve(operation.requestBody, components, [], 0);
	if (isObject(requestBody) && isObject(requestBody.content)) {
		const content = requestBody.content;
		const media = content['application/json'] ?? content['multipart/form-data'];
		if (isObject(media) && isObject(media.schema)) body = media.schema as JsonSchema;
	}

	let response: JsonSchema | null = null;
	const responses = isObject(operation.responses) ? operation.responses : {};
	const ok = resolve(responses['200'], components, [], 0);
	if (isObject(ok) && isObject(ok.content)) {
		const media = ok.content['application/json'];
		const envelope = isObject(media) ? media.schema : undefined;
		const data =
			isObject(envelope) && isObject(envelope.properties) ? envelope.properties.data : undefined;
		if (isObject(data) && !isEmptySchema(data as JsonSchema)) response = data as JsonSchema;
	}

	return {
		params: parametersSchema(parameters, 'path', components),
		query: parametersSchema(parameters, 'query', components),
		body,
		response
	};
}
