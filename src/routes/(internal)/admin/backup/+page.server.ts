import {
	BACKUP_FILE_EXT,
	BACKUP_MIN_PASSWORD,
	MERGE_CONFIRM_WORD,
	RESTORE_CONFIRM_WORD,
	UPLOAD_CHUNK_BYTES
} from '$lib/backup/contract';
import { listScopesForBackup } from '$lib/server/core/backup/export';
import { requirePerm } from '../_shared/server-utils';
import { BACKUP_PERMISSION } from './http.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, BACKUP_PERMISSION);
	const scopes = await listScopesForBackup(locals.ctx);
	return {
		scopes,
		twoFactorEnabled: locals.user?.twoFactorEnabled ?? false,
		constants: {
			minPassword: BACKUP_MIN_PASSWORD,
			chunkBytes: UPLOAD_CHUNK_BYTES,
			fileExt: BACKUP_FILE_EXT,
			restoreWord: RESTORE_CONFIRM_WORD,
			mergeWord: MERGE_CONFIRM_WORD
		}
	};
};
