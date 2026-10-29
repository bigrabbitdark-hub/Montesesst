// Tipos e conversões da matriz de risco do PGR (admin). O SERVIDOR é a autoridade das regras
// (validação, cálculo, hash, publicação): aqui só há o formato dos dados e o que a tela precisa para exibi-los.

export const BASE_MATRIZ = '/api/atuacao/pgr/matriz';

// Limites do servidor (matriz-config.ts), usados só para desabilitar o "adicionar".
export const LIMITE_ESCALA = 20;
export const LIMITE_NIVEIS = 100;
export const LIMITE_FAIXAS = 100;

export const FORMULA_CONHECIDA = 'severidade*probabilidade';
export const TEXTO_VAZIO_MATRIZ = 'Nenhuma matriz configurada. A configuração é feita pela equipe técnica.';
export const TEXTO_CONFIRMA_PUBLICAR = 'A versão publicada não poderá ser alterada. Para mudar, crie uma nova versão.';
export const NAO_INFORMADO = 'não informado';

export type StatusMatriz = 'rascunho' | 'publicada' | 'arquivada';

export interface VersaoResumo {
  id: string;
  version_number: number;
  status: StatusMatriz;
  config_sha256: string | null;
  notes: string | null;
  created_by?: string | null;
  published_by?: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Validacao { erros: string[]; pendencias: string[]; pode_publicar?: boolean }

export interface VersaoDetalhe extends VersaoResumo {
  config: unknown;
  validacao?: Validacao;
}

// ---- Formulário (tudo texto: campo vazio fica vazio, nada é presumido) ----
// `k`: chave estável da linha na tela (nunca enviada ao servidor).
let contador = 0;
const nova = () => `l${++contador}`;
export interface ItemEscala { k: string; valor: string; rotulo: string; descricao: string }
export interface ItemNivel { k: string; id: string; rotulo: string; aceitabilidade: string; decisao: string; bloqueia: '' | 'sim' | 'nao' }
export interface ItemFaixa { k: string; min: string; max: string; nivel_id: string }
export interface FormMetodologia { formula: string; validada_por: string; registro: string; data: string; observacoes: string }
export interface FormMatriz {
  severidade: ItemEscala[];
  probabilidade: ItemEscala[];
  niveis: ItemNivel[];
  faixas: ItemFaixa[];
  metodologia: FormMetodologia;
}

export const escalaVazia = (): ItemEscala => ({ k: nova(), valor: '', rotulo: '', descricao: '' });
export const nivelVazio = (): ItemNivel => ({ k: nova(), id: '', rotulo: '', aceitabilidade: '', decisao: '', bloqueia: '' });
export const faixaVazia = (): ItemFaixa => ({ k: nova(), min: '', max: '', nivel_id: '' });
export const formVazio = (): FormMatriz => ({
  severidade: [], probabilidade: [], niveis: [], faixas: [],
  metodologia: { formula: '', validada_por: '', registro: '', data: '', observacoes: '' },
});

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const txt = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

// Config do servidor (pode ser {} ou incompleto) -> formulário.
export function configParaForm(config: unknown): FormMatriz {
  const c = isObj(config) ? config : {};
  const m = isObj(c.metodologia) ? c.metodologia : {};
  return {
    severidade: lista(c.severidade).map((i) => ({ k: nova(), valor: num(i.valor), rotulo: txt(i.rotulo), descricao: txt(i.descricao) })),
    probabilidade: lista(c.probabilidade).map((i) => ({ k: nova(), valor: num(i.valor), rotulo: txt(i.rotulo), descricao: txt(i.descricao) })),
    niveis: lista(c.niveis).map((n) => ({
      k: nova(), id: txt(n.id), rotulo: txt(n.rotulo), aceitabilidade: txt(n.aceitabilidade), decisao: txt(n.decisao),
      bloqueia: n.bloqueia_emissao === true ? 'sim' : n.bloqueia_emissao === false ? 'nao' : '',
    })),
    faixas: lista(c.faixas).map((f) => ({ k: nova(), min: num(f.min), max: num(f.max), nivel_id: txt(f.nivel_id) })),
    metodologia: {
      formula: txt(m.formula), validada_por: txt(m.validada_por), registro: txt(m.registro), data: txt(m.data), observacoes: txt(m.observacoes),
    },
  };
}

// Campo numérico vazio vira null: o servidor devolve o erro (rascunho aceita incompleto); nunca inventamos um número.
const inteiro = (s: string): number | null => (s.trim() !== '' && Number.isInteger(Number(s)) ? Number(s) : null);

// Formulário -> config enviada ao servidor. Metodologia sem nenhum campo preenchido é omitida (vira pendência).
export function formParaConfig(f: FormMatriz): Record<string, unknown> {
  const m = f.metodologia;
  const out: Record<string, unknown> = {
    severidade: f.severidade.map((i) => ({ valor: inteiro(i.valor), rotulo: i.rotulo, descricao: i.descricao })),
    probabilidade: f.probabilidade.map((i) => ({ valor: inteiro(i.valor), rotulo: i.rotulo, descricao: i.descricao })),
    niveis: f.niveis.map((n) => ({
      id: n.id, rotulo: n.rotulo, aceitabilidade: n.aceitabilidade, decisao: n.decisao,
      bloqueia_emissao: n.bloqueia === 'sim' ? true : n.bloqueia === 'nao' ? false : null,
    })),
    faixas: f.faixas.map((x) => ({ min: inteiro(x.min), max: inteiro(x.max), nivel_id: x.nivel_id })),
  };
  if (Object.values(m).some((v) => v.trim() !== '')) {
    out.metodologia = {
      ...(m.formula ? { formula: m.formula } : {}),
      ...(m.validada_por.trim() ? { validada_por: m.validada_por } : {}),
      ...(m.registro.trim() ? { registro: m.registro } : {}),
      ...(m.data ? { data: m.data } : {}),
      ...(m.observacoes.trim() ? { observacoes: m.observacoes } : {}),
    };
  }
  return out;
}

// ---- Prévia (somente exibição; o servidor é a referência) ----
export interface CelulaPrevia { sev: ItemEscala; prob: ItemEscala; score: number; nivel: string | null; conflito: boolean }

// Devolve null quando as escalas ainda não permitem montar a grade (vazias ou valores não inteiros).
export function calcularPrevia(f: FormMatriz): CelulaPrevia[][] | null {
  const ok = (e: ItemEscala[]) => e.length > 0 && e.every((i) => inteiro(i.valor) !== null);
  if (!ok(f.severidade) || !ok(f.probabilidade)) return null;
  const faixas = f.faixas
    .map((x) => ({ min: inteiro(x.min), max: inteiro(x.max), nivel_id: x.nivel_id }))
    .filter((x): x is { min: number; max: number; nivel_id: string } => x.min !== null && x.max !== null);
  const rotulo = (id: string) => {
    const n = f.niveis.find((v) => v.id === id);
    // nível inexistente: nunca mostra o id cru (o servidor reporta o erro)
    return n ? (n.rotulo.trim() || n.id) : null;
  };
  return f.severidade.map((sev) =>
    f.probabilidade.map((prob) => {
      const score = Number(sev.valor) * Number(prob.valor);
      const dentro = faixas.filter((x) => score >= x.min && score <= x.max);
      return { sev, prob, score, nivel: dentro.length === 1 ? rotulo(dentro[0].nivel_id) : null, conflito: dentro.length > 1 };
    }),
  );
}

export function hashAbreviado(h: string | null): string { return h ? h.slice(0, 12) : NAO_INFORMADO; }
export function usuarioAbreviado(id: string | null | undefined): string { return id ? `usuário ${id.slice(0, 8)}` : NAO_INFORMADO; }
export function dataBr(iso: string | null): string {
  if (!iso) return NAO_INFORMADO;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? NAO_INFORMADO : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
