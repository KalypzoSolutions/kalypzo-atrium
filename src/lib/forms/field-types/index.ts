import { hasFieldType, registerFieldType, type FieldTypeSpec } from '../registry';
import { booleanFieldType } from './boolean';
import { consentFieldType } from './consent';
import { dateFieldType } from './date';
import { emailFieldType } from './email';
import { infoFieldType } from './info';
import { multiselectFieldType } from './multiselect';
import { numberFieldType } from './number';
import { phoneFieldType } from './phone';
import { sectionFieldType } from './section';
import { selectFieldType } from './select';
import { textFieldType } from './text';
import { textareaFieldType } from './textarea';

const builtIns = [
	textFieldType,
	textareaFieldType,
	numberFieldType,
	emailFieldType,
	phoneFieldType,
	dateFieldType,
	selectFieldType,
	multiselectFieldType,
	booleanFieldType,
	infoFieldType,
	sectionFieldType,
	consentFieldType
] as unknown as FieldTypeSpec[];

/** Registriert die Standard-Feldtypen (idempotent). */
export function registerBuiltInFieldTypes(): void {
	for (const spec of builtIns) {
		if (!hasFieldType(spec.type)) registerFieldType(spec);
	}
}

registerBuiltInFieldTypes();
