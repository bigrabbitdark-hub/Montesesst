import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

// Bloqueio conhecido (plano Fase 1, "Bloqueio conhecido"): o HTML de
// referência (docs/dashboard-v2/reference/dashboard-referencia.html) ainda não
// está no repositório. O teste fica skip até lá, de propósito, para não
// reportar uma suíte "verde" que não compara nada.
const REFERENCE_PATH = resolve(process.cwd(), '../docs/dashboard-v2/reference/dashboard-referencia.html');
const hasReference = existsSync(REFERENCE_PATH);

test.describe('Comparativo visual — dashboard Início', () => {
  test.skip(!hasReference, 'HTML de referência ainda não está no repositório (docs/dashboard-v2/reference/)');

  test('grade do dashboard bate com a referência em 1440x960', async ({ page }) => {
    await page.goto(pathToFileURL(REFERENCE_PATH).href);
    await expect(page).toHaveScreenshot('reference.png');

    // Depende de fixture de usuário empresa (login real) — fora do escopo da Fase 1.
    await page.goto('/empresa/dashboard');
    await expect(page).toHaveScreenshot('implementado.png');
  });
});
