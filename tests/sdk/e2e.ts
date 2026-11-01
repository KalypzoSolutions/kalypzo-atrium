/**
 * E2E-Teil der Test-Schnittstelle (`$testing/e2e`): Helfer für Playwright-Specs der Module, ohne Vite/SvelteKit
 * (reines Node). Specs in `modules/<id>/e2e/` importieren nur von hier.
 */
export { startS3Mock, type S3Mock } from '../helpers/s3-mock';
export { startAiMock, type AiMock } from '../helpers/ai-mock';
