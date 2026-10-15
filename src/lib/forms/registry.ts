import type { z } from 'zod';
import type { FieldDefinition, FieldType } from './types';

/**
 * Beschreibung eines Feldtyps. Neue Feldtypen werden nur hier registriert; Renderer, Builder und
 * Validierung enthalten keine type-Switches außerhalb der Registry.
 */
export interface FieldTypeSpec<F extends FieldDefinition = FieldDefinition> {
	type: F['type'];
	/** Anzeigename im Builder, z. B. „Kurztext“ */
	label: string;
	description?: string;
	/** Icon-Schlüssel (siehe `components/layout/icons.ts`) */
	icon: string;
	/** `false` für reine Anzeige (info) – kein Wert, keine Validierung */
	hasValue: boolean;
	/** Neues Feld mit Standardwerten */
	create(id: string, key: string): F;
	/** Zod-Schema des WERTS (ohne Pflicht-Behandlung; `required` wird zentral ergänzt) */
	schema(field: F): z.ZodType;
}

const specs = new Map<string, FieldTypeSpec>();

export function registerFieldType<F extends FieldDefinition>(spec: FieldTypeSpec<F>): void {
	if (specs.has(spec.type)) {
		throw new Error(`Feldtyp "${spec.type}" ist bereits registriert`);
	}
	specs.set(spec.type, spec as unknown as FieldTypeSpec);
}

export function getFieldType(type: FieldType | string): FieldTypeSpec {
	const spec = specs.get(type);
	if (!spec) throw new Error(`Unbekannter Feldtyp "${type}"`);
	return spec;
}

export function hasFieldType(type: string): boolean {
	return specs.has(type);
}

export function listFieldTypes(): FieldTypeSpec[] {
	return [...specs.values()];
}
