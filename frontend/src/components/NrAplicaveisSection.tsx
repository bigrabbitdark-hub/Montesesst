interface NrOpcao {
  code: string;
  nome: string;
}

// Bloco do relatório de visita técnica. Presentacional: quem carrega e salva é a página.
export function NrAplicaveisSection({
  catalogo,
  selecionadas,
  disabled,
  salvando = false,
  onChange,
}: {
  catalogo: NrOpcao[];
  selecionadas: string[];
  disabled: boolean;
  salvando?: boolean;
  onChange: (proximas: string[]) => void;
}) {
  function alternar(code: string) {
    if (disabled) return;
    const marcadas = new Set(selecionadas);
    if (marcadas.has(code)) marcadas.delete(code);
    else marcadas.add(code);
    onChange(catalogo.map((n) => n.code).filter((c) => marcadas.has(c)));
  }

  return (
    <section className="mt-6 rounded-lg border border-brand-100 p-6">
      <h2 className="text-lg font-bold text-brand-900">NRs aplicáveis à empresa</h2>
      <p className="mt-2 text-sm text-brand-700">
        A aplicabilidade é decisão do técnico. O sistema não decide nem afirma obrigação legal. A marcação passa a valer
        ao concluir a visita e alimenta o cartão &quot;Conformidade por NR&quot; do painel da empresa.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {catalogo.map((n) => (
          <li key={n.code}>
            <label className="flex items-center gap-2 text-sm text-brand-900">
              <input
                type="checkbox"
                checked={selecionadas.includes(n.code)}
                disabled={disabled}
                onChange={() => alternar(n.code)}
              />
              <span>
                <strong>{n.code}</strong> · {n.nome}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {salvando && (
        <p role="status" className="mt-2 text-sm text-brand-700">
          Salvando…
        </p>
      )}
    </section>
  );
}
