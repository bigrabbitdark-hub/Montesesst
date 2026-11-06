import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { useAtuando } from '../useAtuando';
import { startActing, stopActing } from '../acting';

function Probe() { return <span>{String(useAtuando())}</span>; }

describe('useAtuando', () => {
  beforeEach(() => localStorage.clear());

  it('no cliente já devolve o valor real no primeiro render (sem piscar)', () => {
    expect(renderHook(() => useAtuando()).result.current).toBe(false);
    localStorage.setItem('montese_acting', JSON.stringify({ tenantId: 't', tenantName: 'X', expiresAt: Date.now() + 1000 }));
    expect(renderHook(() => useAtuando()).result.current).toBe(true);
  });

  it('no servidor (renderToString) vale null', () => {
    expect(renderToString(<Probe />)).toContain('null');
  });

  it('startActing e stopActing atualizam o hook na mesma aba', () => {
    localStorage.setItem('montese_token', 'T');
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u1', role: 'socio', tenantId: null }));
    const { result } = renderHook(() => useAtuando());
    expect(result.current).toBe(false);
    act(() => { startActing('ACT', 1800, { id: 't1', name: 'X' }); });
    expect(result.current).toBe(true);
    act(() => { stopActing(); });
    expect(result.current).toBe(false);
  });

  it('evento storage (outra aba) atualiza o hook', () => {
    const { result } = renderHook(() => useAtuando());
    act(() => {
      localStorage.setItem('montese_acting', JSON.stringify({ tenantId: 't', tenantName: 'X', expiresAt: Date.now() + 1000 }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'montese_acting' }));
    });
    expect(result.current).toBe(true);
  });
});
