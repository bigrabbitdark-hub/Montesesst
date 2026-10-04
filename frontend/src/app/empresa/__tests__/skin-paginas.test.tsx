import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/DocumentsPanel', () => ({ DocumentsPanel: () => <div data-testid="painel" /> }));
vi.mock('@/components/EpisPanel', () => ({ EpisPanel: () => <div data-testid="painel" /> }));
vi.mock('@/components/AssistantChat', () => ({ AssistantChat: () => <div data-testid="painel" /> }));
vi.mock('@/components/AssistantSummaryPanel', () => ({ AssistantSummaryPanel: () => <div /> }));
vi.mock('@/components/PenteFinoPanel', () => ({ PenteFinoPanel: () => <div /> }));
vi.mock('@/components/FireBrigadePanel', () => ({ FireBrigadePanel: () => <div data-testid="painel" /> }));
vi.mock('@/components/FireSafetyEquipmentPanel', () => ({ FireSafetyEquipmentPanel: () => <div data-testid="painel" /> }));
vi.mock('@/components/PreventionChecklistPanel', () => ({ PreventionChecklistPanel: () => <div data-testid="painel" /> }));
vi.mock('@/components/EmergencyDrillPanel', () => ({ EmergencyDrillPanel: () => <div data-testid="painel" /> }));
vi.mock('@/components/MapaSstPanel', () => ({ MapaSstPanel: () => <div data-testid="painel" /> }));

import Documentos from '../documentos/page';
import Epis from '../epis/page';
import Assistente from '../assistente/page';
import Brigada from '../brigada/page';
import Equipamentos from '../equipamentos-incendio/page';
import Checklist from '../checklist-prevencao/page';
import Simulados from '../simulados/page';
import MapaSst from '../mapa-sst/page';

beforeEach(() => localStorage.setItem('montese_token', 'x'));

describe.each([
  ['Documentos', Documentos, 'Documentos'],
  ['EPIs', Epis, 'Catálogo de EPI'],
  ['Assistente', Assistente, 'Assistente Montese SST'],
  ['Brigada', Brigada, 'Brigada de incêndio'],
  ['Equipamentos contra incêndio', Equipamentos, 'Equipamentos contra incêndio'],
  ['Checklist de prevenção', Checklist, 'Checklist de prevenção'],
  ['Simulados', Simulados, 'Simulados de emergência'],
  ['Mapa SST', MapaSst, 'Mapa SST'],
])('página %s (lotes 1 e 2)', (_n, Pagina, titulo) => {
  it('mostra o título e coloca o painel dentro do escopo .skin-dash', async () => {
    const { container } = render(<Pagina />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: titulo })).toBeInTheDocument());
    const painel = screen.getByTestId('painel');
    expect(painel.closest('.skin-dash')).not.toBeNull();
    // O título e o cabeçalho ficam fora do escopo: só o miolo remapeia tokens.
    expect(screen.getByRole('heading', { level: 1 }).closest('.skin-dash')).toBeNull();
    expect(container.querySelectorAll('.skin-dash')).toHaveLength(1);
  });
});
