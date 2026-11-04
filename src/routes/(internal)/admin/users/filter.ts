import {
	USER_SORTS,
	USER_STATUS_FILTERS,
	type UserListFilter,
	type UserSort,
	type UserStatusFilter
} from '$lib/server/core/auth/users';

/** Filter der Benutzerliste aus der URL (`q`, `status`, `tfa`, `role` mehrfach, `admins`, `sort`); Unbekanntes wird ignoriert. */
export function parseUserFilter(p: URLSearchParams): UserListFilter & { sort?: UserSort } {
	const status = p.get('status');
	const tfa = p.get('tfa');
	const sort = p.get('sort');
	const search = p.get('q')?.trim().slice(0, 100);
	return {
		search: search || undefined,
		status: (USER_STATUS_FILTERS as readonly string[]).includes(status ?? '')
			? (status as UserStatusFilter)
			: undefined,
		twoFactor: tfa === 'on' ? true : tfa === 'off' ? false : undefined,
		roleIds: p
			.getAll('role')
			.filter((r) => r && r.length <= 64)
			.slice(0, 50),
		admins: p.get('admins') === '1' || undefined,
		sort: (USER_SORTS as readonly string[]).includes(sort ?? '') ? (sort as UserSort) : undefined
	};
}
