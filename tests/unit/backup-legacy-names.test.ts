/**
 * Datensicherung (Phase N): neue Kennungen `.atriumbackup`/`atrium-backup`, ältere Sicherungen (EP Intern)
 * bleiben einspielbar; Bestätigungswörter je Sprache, das deutsche Wort gilt immer.
 */
import { describe, expect, it } from 'vitest';
import {
	BACKUP_FILE_EXT,
	BACKUP_FORMAT,
	confirmWord,
	isBackupFileName,
	isConfirmWord,
	MERGE_CONFIRM_WORD,
	RESTORE_CONFIRM_WORD
} from '$lib/backup/contract';
import { backupMeta } from '$lib/server/core/backup/types';
import { isResetConfirmWord, RESET_CONFIRM_WORD } from '$lib/server/core/system/reset';

describe('Datensicherung: Kennungen und Übergang', () => {
	it('neue Endung und alte Endung werden angenommen', () => {
		expect(BACKUP_FILE_EXT).toBe('.atriumbackup');
		expect(BACKUP_FORMAT).toBe('atrium-backup');
		expect(isBackupFileName('atrium-sicherung-2026-11-01-10-00.atriumbackup')).toBe(true);
		expect(isBackupFileName('ep-intern-sicherung-2026-10-01-10-00.EPBACKUP')).toBe(true);
		expect(isBackupFileName('sicherung.zip')).toBe(false);
	});

	it('backup.json mit alter Formatkennung bleibt gültig', () => {
		const shape = (format: string) =>
			backupMeta.safeParse({ format }).error?.issues.some((i) => i.path[0] === 'format');
		expect(shape('atrium-backup')).toBe(false);
		expect(shape('ep-intern-backup')).toBe(false);
		expect(shape('fremd')).toBe(true);
	});

	it('Bestätigungswörter: Sprache der Anfrage und immer Deutsch', () => {
		expect(confirmWord('restore')).toBe(RESTORE_CONFIRM_WORD);
		expect(isConfirmWord('restore', RESTORE_CONFIRM_WORD)).toBe(true);
		expect(isConfirmWord('merge', MERGE_CONFIRM_WORD)).toBe(true);
		expect(isConfirmWord('merge', RESTORE_CONFIRM_WORD)).toBe(false);
		expect(isResetConfirmWord(RESET_CONFIRM_WORD)).toBe(true);
		expect(isResetConfirmWord('zurücksetzen')).toBe(false);
	});
});
