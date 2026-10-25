export interface SegmentedOption<T extends string = string> {
	value: T;
	label: string;
	/** nicht wählbar (z. B. „Aus“ bei verbindlichen Benachrichtigungen) */
	disabled?: boolean;
	/** Hinweis als Tooltip/`title` */
	hint?: string;
}
