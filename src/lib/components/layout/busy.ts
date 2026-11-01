/**
 * Einheitliche Ladetexte für Knöpfe und Statuszeilen (#71): 3. Person + Leerzeichen + echte Ellipse „…“.
 * Nie „Speichere …“ oder „Suchen ...“.
 *
 * Core: die Funktionen (`busySave()` …) liefern den Text in der aktuellen Sprache. Die Konstanten
 * (`BUSY_SAVE` …) bleiben für die (deutschen) Fachmodule und sind fest Deutsch – eine Konstante auf
 * Modulebene kann der Sprache des Requests nicht folgen.
 */
import { t, tl } from '$lib/i18n';

export const busySave = (): string => t('layout.busy.save');
export const busyLoad = (): string => t('layout.busy.load');
export const busyDelete = (): string => t('layout.busy.delete');
export const busySend = (): string => t('layout.busy.send');
export const busyUpload = (): string => t('layout.busy.upload');

export const BUSY_SAVE = tl('de', 'layout.busy.save');
export const BUSY_LOAD = tl('de', 'layout.busy.load');
export const BUSY_DELETE = tl('de', 'layout.busy.delete');
export const BUSY_SEND = tl('de', 'layout.busy.send');
export const BUSY_UPLOAD = tl('de', 'layout.busy.upload');
