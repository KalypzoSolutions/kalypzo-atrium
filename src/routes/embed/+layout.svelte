<script lang="ts">
	// Schlanker Rahmen für eingebettete Modulseiten (iframe): ohne Seitenleiste und Kopfzeile, volle Höhe.
	// Theme, Akzentfarbe und Toaster kommen aus dem Root-Layout.
	let { children } = $props();
</script>

<main id="main" tabindex="-1" class="flex h-dvh min-h-0 flex-col outline-none">
	{@render children()}
</main>
