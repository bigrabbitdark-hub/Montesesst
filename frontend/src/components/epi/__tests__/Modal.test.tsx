import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../Modal';

describe('Modal: Esc', () => {
  it('fecha com Esc mesmo com o foco no corpo da página, fora do diálogo', () => {
    const onClose = vi.fn();
    render(<Modal title="T" onClose={onClose}><input aria-label="campo" /></Modal>);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('com o foco dentro do diálogo fecha uma só vez', () => {
    const onClose = vi.fn();
    render(<Modal title="T" onClose={onClose}><input aria-label="campo" /></Modal>);
    fireEvent.keyDown(screen.getByLabelText('campo'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('durante o envio (busy) não fecha, nem pelo corpo da página', () => {
    const onClose = vi.fn();
    render(<Modal title="T" busy onClose={onClose}><p>x</p></Modal>);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
  it('depois de desmontar, o Esc na página não chama mais onClose', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Modal title="T" onClose={onClose}><p>x</p></Modal>);
    unmount();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
