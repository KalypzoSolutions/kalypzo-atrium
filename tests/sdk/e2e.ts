/**
 * E2E-Teil der Test-Schnittstelle (`$testing/e2e`): Helfer für Playwright-Specs der Module, ohne Vite/SvelteKit
 * (reines Node). Specs in `modules/<id>/e2e/` importieren nur von hier.
 */

export { type AiMock, startAiMock } from '../helpers/ai-mock';
export { type S3Mock, startS3Mock } from '../helpers/s3-mock';
