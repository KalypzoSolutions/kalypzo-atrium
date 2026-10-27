<script lang="ts" module>
	interface NativeDetected {
		rawValue: string;
	}
	interface NativeDetector {
		detect(source: HTMLVideoElement): Promise<NativeDetected[]>;
	}
	type DetectorFactory = () => Promise<NativeDetector>;

	const FORMATS = ['qr_code', 'code_128', 'data_matrix', 'ean_13', 'code_39'];

	let factory: Promise<DetectorFactory> | undefined;

	/** Natives `BarcodeDetector` (Chrome/Android), sonst zxing-wasm (iOS/Firefox), WASM selbst gehostet */
	function detectorFactory(): Promise<DetectorFactory> {
		factory ??= (async () => {
			const Native = (
				globalThis as unknown as {
					BarcodeDetector?: {
						new (o: { formats: string[] }): NativeDetector;
						getSupportedFormats(): Promise<string[]>;
					};
				}
			).BarcodeDetector;
			if (Native) {
				try {
					const supported = await Native.getSupportedFormats();
					if (supported.includes('qr_code')) {
						return async () =>
							new Native({ formats: FORMATS.filter((f) => supported.includes(f)) });
					}
				} catch {
					// Rückfall auf zxing
				}
			}
			const [{ BarcodeDetector, prepareZXingModule }, wasm] = await Promise.all([
				import('barcode-detector/ponyfill'),
				import('zxing-wasm/reader/zxing_reader.wasm?url')
			]);
			prepareZXingModule({
				overrides: {
					locateFile: (path: string, prefix: string) =>
						path.endsWith('.wasm') ? wasm.default : prefix + path
				}
			});
			return async () =>
				new BarcodeDetector({
					formats: ['qr_code', 'code_128', 'data_matrix', 'ean_13', 'code_39']
				}) as unknown as NativeDetector;
		})();
		return factory;
	}
</script>

<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import Flashlight from '@lucide/svelte/icons/flashlight';
	import SwitchCamera from '@lucide/svelte/icons/switch-camera';
	import { Button } from '$lib/components/ui/button';

	let {
		onscan,
		paused = false,
		repeatMs = 2000,
		class: className = ''
	}: {
		/** Erkannter Code (derselbe Code erst nach `repeatMs` erneut) */
		onscan: (code: string) => void;
		/** Erkennung anhalten (Kamera bleibt an) */
		paused?: boolean;
		repeatMs?: number;
		class?: string;
	} = $props();

	let video: HTMLVideoElement | undefined = $state();
	let stream: MediaStream | null = null;
	let status = $state<'idle' | 'starting' | 'running' | 'error'>('idle');
	let message = $state('');
	let torchAvailable = $state(false);
	let torchOn = $state(false);
	let cameras = $state<MediaDeviceInfo[]>([]);
	let cameraIndex = $state(-1);
	let flash = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let destroyed = false;
	let lastCode = '';
	let lastAt = 0;

	function errorText(e: unknown): string {
		const name = e instanceof Error ? e.name : '';
		if (!window.isSecureContext)
			return 'Die Kamera funktioniert nur über eine sichere Verbindung (HTTPS).';
		if (name === 'NotAllowedError')
			return 'Kamerazugriff verweigert. Erlaube die Kamera in den Browser-Einstellungen.';
		if (name === 'NotFoundError' || name === 'OverconstrainedError')
			return 'Keine Kamera gefunden. Du kannst den Code auch eintippen oder einen USB-Scanner nutzen.';
		if (name === 'NotReadableError') return 'Die Kamera wird gerade von einer anderen App benutzt.';
		return 'Die Kamera konnte nicht gestartet werden.';
	}

	async function start() {
		stop();
		if (!navigator.mediaDevices?.getUserMedia) {
			status = 'error';
			message = errorText(new Error());
			return;
		}
		status = 'starting';
		try {
			const deviceId = cameras[cameraIndex]?.deviceId;
			stream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: deviceId
					? { deviceId: { exact: deviceId } }
					: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
			});
			if (destroyed) return stop();
			if (!cameras.length) {
				cameras = (await navigator.mediaDevices.enumerateDevices()).filter(
					(d) => d.kind === 'videoinput'
				);
			}
			const track = stream.getVideoTracks()[0];
			const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
			torchAvailable = !!caps.torch;
			torchOn = false;
			if (video) {
				video.srcObject = stream;
				await video.play().catch(() => undefined);
			}
			status = 'running';
			const create = await detectorFactory();
			const detector = await create();
			loop(detector);
		} catch (e) {
			stop();
			status = 'error';
			message = errorText(e);
		}
	}

	function loop(detector: NativeDetector) {
		timer = setTimeout(async () => {
			if (destroyed || !stream) return;
			if (!paused && video && video.readyState >= 2) {
				try {
					const found = await detector.detect(video);
					const code = found.find((f) => f.rawValue.trim())?.rawValue.trim();
					const now = Date.now();
					if (code && (code !== lastCode || now - lastAt > repeatMs)) {
						lastCode = code;
						lastAt = now;
						flash = true;
						setTimeout(() => (flash = false), 300);
						navigator.vibrate?.(60);
						onscan(code);
					}
				} catch {
					// einzelnes Bild nicht lesbar – weiter
				}
			}
			loop(detector);
		}, 200);
	}

	function stop() {
		clearTimeout(timer);
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}

	async function toggleTorch() {
		const track = stream?.getVideoTracks()[0];
		if (!track) return;
		try {
			await track.applyConstraints({
				advanced: [{ torch: !torchOn } as unknown as Record<string, never>]
			});
			torchOn = !torchOn;
		} catch {
			torchAvailable = false;
		}
	}

	function switchCamera() {
		if (cameras.length < 2) return;
		cameraIndex = (cameraIndex + 1) % cameras.length;
		void start();
	}

	onMount(() => {
		void start();
	});
	onDestroy(() => {
		destroyed = true;
		stop();
	});
</script>

<div class="relative overflow-hidden rounded-lg border bg-muted {className}">
	<video
		bind:this={video}
		class="aspect-[4/3] w-full object-cover {status === 'running' ? '' : 'invisible'}"
		playsinline
		muted
	></video>
	{#if status === 'running'}
		<div
			class="pointer-events-none absolute inset-[18%] rounded-lg border-2 transition-colors {flash
				? 'border-success'
				: 'border-background/80'}"
			aria-hidden="true"
		></div>
		<div class="absolute right-2 bottom-2 flex gap-2">
			{#if torchAvailable}
				<Button
					size="icon"
					variant="secondary"
					aria-label={torchOn ? 'Taschenlampe aus' : 'Taschenlampe an'}
					aria-pressed={torchOn}
					onclick={toggleTorch}><Flashlight /></Button
				>
			{/if}
			{#if cameras.length > 1}
				<Button size="icon" variant="secondary" aria-label="Kamera wechseln" onclick={switchCamera}
					><SwitchCamera /></Button
				>
			{/if}
		</div>
	{:else}
		<div
			class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm"
		>
			<CameraIcon class="size-8 text-muted-foreground" aria-hidden="true" />
			{#if status === 'error'}
				<p role="alert">{message}</p>
				<Button size="sm" variant="outline" onclick={() => start()}>Erneut versuchen</Button>
			{:else}
				<p class="text-muted-foreground" role="status">Kamera wird gestartet …</p>
			{/if}
		</div>
	{/if}
</div>
