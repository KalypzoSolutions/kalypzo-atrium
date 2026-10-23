/**
 * Vertragstest Stammeswebsite ⇄ Website-Endpunkte (#48): Die handkopierten `Backend*`-Typen der Website
 * müssen exakt den Modul-DTOs entsprechen. Die Typprüfung läuft mit `npm run check`; zur Laufzeit prüft
 * der Test, dass Beispielobjekte der Website-Typen gegen die strikten Zod-Schemas der Module parsen.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
	BackendEvent,
	BackendEventPage,
	BackendGallery,
	BackendGalleryDetail,
	BackendGroup,
	BackendOffice
} from '../../website/src/lib/server/backend-types';
import type { WebsiteEvent } from '$lib/modules/events/schemas';
import type { WebsiteGallery, WebsiteGalleryDetail } from '$lib/modules/galleries/schemas';
import type { WebsiteGroup } from '$lib/modules/members/schemas';
import type { WebsiteOffice } from '$lib/modules/offices/schemas';
import { websiteOfficeSchema } from '$lib/modules/offices/website.schemas';
import {
	websiteEventPageSchema,
	websiteEventSchema,
	type WebsiteEventPage
} from '$lib/modules/events/website.schemas';
import { websiteGalleryDetailSchema } from '$lib/modules/galleries/website.schemas';
import { websiteGroupSchema } from '$lib/modules/members/website.schemas';

const event: BackendEvent = {
	id: 'e1',
	title: 'Gruppenstunde',
	description: null,
	location: 'Heim',
	color: '#2563eb',
	startsOn: '2026-10-20',
	startsTime: '17:00',
	endsOn: null,
	endsTime: null,
	tags: ['Gruppenstunde'],
	groups: ['Stamm'],
	groupIds: ['stamm'],
	recurring: true,
	occurrenceDate: '2026-10-20'
};

describe('Website-Typen = Modul-DTOs', () => {
	it('Typgleichheit (wird von npm run check geprüft)', () => {
		expectTypeOf<BackendEvent>().toEqualTypeOf<WebsiteEvent>();
		expectTypeOf<BackendEventPage>().toEqualTypeOf<WebsiteEventPage>();
		expectTypeOf<BackendGallery>().toEqualTypeOf<WebsiteGallery>();
		expectTypeOf<BackendGalleryDetail>().toEqualTypeOf<WebsiteGalleryDetail>();
		expectTypeOf<BackendGroup>().toEqualTypeOf<WebsiteGroup>();
		expectTypeOf<BackendOffice>().toEqualTypeOf<WebsiteOffice>();
	});

	it('Beispielobjekte der Website parsen gegen die Modul-Schemas', () => {
		expect(websiteEventSchema.parse(event)).toEqual(event);
		const page: BackendEventPage = {
			items: [event],
			total: 1,
			offset: 0,
			limit: 200,
			hasMore: false
		};
		expect(websiteEventPageSchema.parse(page)).toEqual(page);
		const gallery: BackendGalleryDetail = {
			id: 'g1',
			title: 'Lager',
			description: null,
			imageCount: 1,
			cover: { imageId: 'i1', width: 800, height: 600 },
			events: [{ id: 'e1', title: 'Lager', startsOn: '2026-07-01', endsOn: '2026-07-10' }],
			updatedAt: '2026-10-20T10:00:00.000Z',
			images: [
				{ id: 'i1', galleryId: 'g1', description: null, width: 800, height: 600, position: 0 }
			]
		};
		expect(websiteGalleryDetailSchema.parse(gallery)).toEqual(gallery);
		const group: BackendGroup = {
			id: 'gr1',
			slug: 'funkelfuechse',
			name: 'Funkelfüchse',
			type: 'sippe',
			description: null,
			ageRange: '11 bis 14 Jahre',
			meetingPlace: null,
			meetingWeekday: 5,
			meetingTime: '17:00',
			meetingEndTime: '18:30',
			color: null,
			contactEmail: null,
			leaders: [{ firstName: 'Larissa' }],
			imagePath: null
		};
		expect(websiteGroupSchema.parse(group)).toEqual(group);
		const office: BackendOffice = {
			id: 'o1',
			name: 'Stammesführung',
			description: null,
			position: 0,
			emails: [{ label: null, email: 'stafue@stamm.example' }],
			holders: [
				{ id: 'u1', firstName: 'Larissa', bio: null, since: '2024-09-01', avatarPath: null }
			]
		};
		expect(websiteOfficeSchema.parse(office)).toEqual(office);
	});

	it('umbenanntes Feld fällt beim Parsen auf (strikte Schemas)', () => {
		const { occurrenceDate, ...rest } = event;
		expect(websiteEventSchema.safeParse({ ...rest, occurrence: occurrenceDate }).success).toBe(
			false
		);
	});
});
