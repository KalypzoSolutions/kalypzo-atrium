import {
	BACKUP_FILE_EXTS,
	BACKUP_MIN_PASSWORD,
	confirmWord,
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
			/** Endungen für das Dateifeld (neu `.atriumbackup`, alt `.epbackup`) */
			fileExt: BACKUP_FILE_EXTS.join(','),
			restoreWord: confirmWord('restore'),
			mergeWord: confirmWord('merge')
		}
	};
};
