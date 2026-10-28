'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { formatCnpj, type PgrResumo } from '../../../api';
import { LINK } from '../../estilos';

// Etapa 1 — somente leitura: mostra o que veio do cadastro e o que falta. A correção é feita em /atuacao/clientes/[id].
export function ResumoEmpresa({ resumo, tenantId }: { resumo: PgrResumo; tenantId: string }) {
  const imp = resumo.importados ?? {};
  const sim = (v: boolean | undefined, ok = 'Importado') => (v ? ok : v === false ? 'Faltando' : 'Não informado');
  const qtd = (n: number | undefined, un: string) => (n === undefined ? 'Não informado' : n > 0 ? `${n} ${un}` : 'Faltando');
  const linhas: [string, string, boolean][] = [
    ['CNPJ', sim(imp.cnpj), imp.cnpj === true],
    ['CNAE', sim(imp.cnae), imp.cnae === true],
    ['Endereço completo', sim(imp.endereco), imp.endereco === true],
    ['Unidades', qtd(imp.unidades, 'cadastrada(s)'), (imp.unidades ?? 0) > 0],
    ['Cargos', qtd(imp.cargos, 'cadastrado(s)'), (imp.cargos ?? 0) > 0],
    ['Funcionários ativos', qtd(imp.funcionarios, 'cadastrado(s)'), (imp.funcionarios ?? 0) > 0],
  ];
  return (
    <Card title="Empresa">
      <p className="text-sm text-dash-muted">Dados importados do cadastro da empresa. Aqui são somente leitura.</p>
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {linhas.map(([nome, valor, ok]) => (
          <li key={nome} className="py-2">{nome} — <span className={ok ? 'font-semibold text-dash-primary' : 'font-semibold text-dash-status-crit-text'}>{valor}</span></li>
        ))}
        <li className="py-2">Grau de risco — <span className="text-dash-muted">indisponível no cadastro</span> (não é uma pendência)</li>
      </ul>
      <p className="mt-2 text-xs text-dash-muted">CNPJ {formatCnpj(resumo.empresa.cnpj)}</p>
      <p className="mt-4 text-sm">
        <Link href={`/atuacao/clientes/${tenantId}`} className={LINK}>Corrigir no cadastro do cliente</Link>
      </p>
    </Card>
  );
}
