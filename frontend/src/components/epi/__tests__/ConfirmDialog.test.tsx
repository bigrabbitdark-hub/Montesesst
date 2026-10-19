import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';

function Harness({ onConfirm = () => {} }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <ConfirmDialog
        open={open}
        title="Estornar movimentação?"
        description="A movimentação original continua no histórico."
        confirmLabel="Estornar movimentação"
        destructive
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('fechado não renderiza nada', () => {
    render(<ConfirmDialog open={false} title="t" confirmLabel="ok" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('aberto: role dialog, aria-modal, título e descrição associados', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Abrir'));
    const d = screen.getByRole('dialog', { name: 'Estornar movimentação?' });
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(d).toHaveAccessibleDescription('A movimentação original continua no histórico.');
  });
  it('foco vai para o primeiro botão (Cancelar) ao abrir', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Abrir'));
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });
  it('Esc fecha e devolve o foco ao acionador', () => {
    render(<Harness />);
    const abrir = screen.getByText('Abrir');
    abrir.focus();
    fireEvent.click(abrir);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(abrir).toHaveFocus();
  });
  it('botão destrutivo tem texto explícito e dispara onConfirm; Cancelar não dispara', () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Abrir'));
    const btn = screen.getByRole('button', { name: 'Estornar movimentação' });
    expect(btn.className).toContain('bg-red-700');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Abrir'));
    fireEvent.click(screen.getByRole('button', { name: 'Estornar movimentação' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  it('Tab no último botão volta ao primeiro (foco preso) e Shift+Tab no primeiro vai ao último', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Abrir'));
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    const confirm = screen.getByRole('button', { name: 'Estornar movimentação' });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
  });
  it('foco no container: Shift+Tab vai ao último botão e Tab ao primeiro (não sai do diálogo)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Abrir'));
    const box = screen.getByRole('dialog');
    box.focus();
    expect(box).toHaveFocus();
    fireEvent.keyDown(box, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Estornar movimentação' })).toHaveFocus();
    box.focus();
    fireEvent.keyDown(box, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });
  it('ocupado: botões aria-disabled sem efeito, Esc não fecha e o foco permanece no diálogo (Tab preso)', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="t" confirmLabel="Apagar" busy onConfirm={onConfirm} onCancel={onCancel} />);
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    const confirm = screen.getByRole('button', { name: 'Aguarde...' });
    expect(cancel).toHaveAttribute('aria-disabled', 'true');
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);
    fireEvent.click(confirm);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });
});

describe('camadas e rolagem dos diálogos', () => {
  it('ConfirmDialog fica acima do botão flutuante (z-[60]), rola e deixa folga inferior', () => {
    render(<ConfirmDialog open title="T" confirmLabel="Ok" onConfirm={() => {}} onCancel={() => {}} />);
    const outer = screen.getByRole('dialog').parentElement!;
    expect(outer.className).toContain('z-[60]');
    expect(outer.className).toContain('overflow-y-auto');
    expect(outer.className).toContain('pb-24');
  });
  it('Modal fica acima do botão flutuante (z-[60]) e com folga inferior para o conteúdo do QR', async () => {
    const { Modal } = await import('../Modal');
    render(<Modal title="M" onClose={() => {}}><p>x</p></Modal>);
    const outer = screen.getByRole('dialog').parentElement!;
    expect(outer.className).toContain('z-[60]');
    expect(outer.className).toContain('pb-24');
    expect(outer.className).toContain('overflow-y-auto');
  });
});
