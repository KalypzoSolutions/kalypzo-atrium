// Host-ABI im Browser: Module bekommen nur `toast` aus der Instanz des Core (ein `<Toaster>` im Root-Layout).
// Der volle Namespace von `svelte-sonner` würde jede Seite um ~23 KB vergrößern (tools/host-abi.js).
export { toast } from 'svelte-sonner';
