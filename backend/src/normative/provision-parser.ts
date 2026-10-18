// Parser DETERMINÍSTICO de dispositivos (artigo/item/anexo) sobre o raw_text de um documento
// normativo. Sem I/O e sem modelo: onde não reconhece a estrutura, não cria linha — o que
// sobra aparece em `coverage` e `anomalies`, nunca é preenchido às cegas.
// Cabeçalho de anexo que não é reconhecido como anexo NOVO (repetido, `ANEXO “A”`, …) põe o texto seguinte em
// QUARENTENA até o próximo anexo novo ou seção titulada: é preferível não citar a citar com endereço errado.
// `ANEXO (*)` sozinho é anexo novo de id literal '(*)'. Seção titulada (ver isSectionTitle) dentro de um anexo
// dá aos itens seguintes o rótulo `<anexo>/<TÍTULO>`.
// Medição (seed-data): ver .superpowers/sdd/2026-10-09-base-normativa-lip/final-fix-report.md e parser-pending-report.md.
// Heurística: não é garantia de cobertura total.
// 'lei': leis, decretos e códigos (CLT, Lei 8.213, Decreto 3.048…); 'clt' é o nome antigo do mesmo parser (compatibilidade).
export type ParserKind = 'nr' | 'lei' | 'clt';

export interface ParsedProvision {
  anexo: string;
  item_path: string;
  heading: string | null;
  literal_text: string;
  char_start: number;
  char_end: number;
}

export interface ParseAnomaly {
  // 'cauda_nao_classificada' (só no parser 'lei'): assinatura, aviso "Este texto não substitui…" ou anexo depois do
  // último artigo; o trecho até o fim do texto não vira dispositivo (ver LEI_CAUDA_RE).
  kind: 'anexo_repetido' | 'anexo_nao_reconhecido' | 'item_repetido' | 'item_ambiguo' | 'cauda_nao_classificada';
  line: number;
  detail: string;
}

export interface ParseResult {
  provisions: ParsedProvision[];
  anomalies: ParseAnomaly[];
  total_chars: number;
  covered_chars: number;
  coverage: number;
  // Todos os anexos reconhecidos e as seções tituladas (id `<anexo>/<TÍTULO>`), em ordem de aparição (inclusive
  // sem dispositivos, exceto seção sem nenhum item, que é devolvida ao trecho anterior). O corpo é id '' e
  // header_line 0, e só aparece se tiver texto. `chars` vai do cabeçalho até o próximo cabeçalho de anexo ou seção
  // (reconhecido ou em quarentena); texto em quarentena não pertence a nenhum anexo.
  anexos: ParsedAnexo[];
  // Um trecho por cabeçalho que pôs o texto em quarentena; `chars` vai do cabeçalho até o próximo cabeçalho/seção.
  quarantines: ParsedQuarantine[];
}

export interface ParsedQuarantine {
  header_line: number;
  header: string;
  chars: number;
}

export interface ParsedAnexo {
  id: string;
  header_line: number;
  provisions: number;
  chars: number;
  covered_chars: number;
}

export const PARSER_VERSION = 'provision-parser/1';

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
// Ocorrência "curta" (título de sumário) na resolução de colisões de chave.
const TOC_MAX_CHARS = 160;
// Linha candidata a cabeçalho de anexo (para a quarentena) tem no máximo isto.
const ANEXO_HEADER_MAX_CHARS = 60;

function romanToInt(s: string): number {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]];
    const next = ROMAN[s[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

// "ANEXO Nº 13-A" → "13-A"; "ANEXO IV" → "4"; "ANEXO (*)" e "ANEXO “A”" não casam (ver looksLikeAnexoHeader).
const ANEXO_RE = /^ANEXO\s+(?:N[º°o]\s*)?(\d+(?:-[A-Z])?|[IVXLC]+)\s*(?:\(\*\))?\s*$/i;
// "ANEXO (*)" sozinho na linha (NR-16.txt:829): a fonte não numera esse anexo; id literal '(*)', sem normalizar.
const ANEXO_SEM_NUMERO_RE = /^ANEXO\s*\(\*\)$/;
// "Anexo I da NR-01" sozinho na linha, em caixa mista exatamente assim (NR-01.txt:506, 587; texto vigente
// NR-01-vigente-2026-05-26.txt:574, 692): anexo NOVO, id normalizado (romano → arábico). Nada depois do número
// da NR (sem pontuação final: "Anexo XII da NR-12;" NR-18.txt:966 é fim de frase; "Anexo I da NR-36 - Glossário"
// NR-36.txt:31 é sumário). A forma em CAIXA ALTA ("ANEXO I da NR-09", NR-09.txt:99) continua em quarentena:
// fora do escopo desta mudança (mudaria ~13 NRs sem medição/validação por norma).
const ANEXO_DA_NR_RE = /^Anexo\s+(\d+(?:-[A-Z])?|[IVXLC]+)\s+da\s+NR[\s-]?\d+$/;
// Exige ponto (15.1, 1.1.1 ou "3.") e iniciar em maiúscula/abre-parêntese/aspas: linhas de
// tabela como "85 dB(A) 8 horas", "250 L" ou "0.5 mg/m3" não são item. Primeiro segmento com 4+ dígitos é
// ano/continuação, não item ("2021. (Alterado pela Portaria MTP nº 806…" NR-15.txt:5581, fim do 7.4 do Anexo 13-A).
const NR_ITEM_RE = /^(\d{1,3}(?:\.\d+)+\.?|\d{1,3}\.)\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ("“])/;
// Seção titulada: linha toda em MAIÚSCULAS (3–90 chars, sem dígitos, ≥ 2 maiúsculas seguidas, não "ANEXO…") cuja
// próxima linha não vazia é a nota de ato normativo ("MANGANÊS E SEUS COMPOSTOS" + "(Incluído pela Portaria…"
// NR-15.txt:5092-5093). "(Revogado…" não abre seção (o "AGENTES BIOLÓGICOS" revogado, NR-15.txt:5677-5678).
const SECAO_NOTA_RE = /^\((?:Incluído|Instituído|Adotado|Alterado|Redação)/;
function isSectionTitle(t: string): boolean {
  return t.length >= 3 && t.length <= 90 && !/\d/.test(t) && /\p{Lu}{2}/u.test(t) && t === t.toUpperCase() && !/^ANEXO/.test(t);
}
// Título que CONTINUA outro: a linha não vazia anterior também é título em maiúsculas (aqui com dígitos permitidos,
// mas não item numerado nem cabeçalho "ANEXO…", que já é tratado como anexo/quarentena: "ANEXO III" seguido de "MANGANÊS E SEUS
// COMPOSTOS" + "(Incluído…" abre a seção, como antes — trecho do teste com NR-15.txt:5072 e 5092-5093). "QUADRO 1 - PERIODICIDADE DOS EXAMES RADIOLÓGICOS PARA EMPREGADOS EXPOSTOS" + "POEIRA
// CONTENDO SÍLICA, ASBESTO OU CARVÃO MINERAL" + "(Alterado…" (NR-07.txt:914-916): a 2ª linha NÃO abre seção (antes os
// itens 3, 3.1–3.7 do Anexo III saíam como `3/POEIRA CONTENDO…`); só encerra o item aberto, no mesmo ponto em que a
// seção o encerraria (o item anterior não engole a tabela do quadro).
function isUpperTitleLine(t: string): boolean {
  return t.length >= 3 && /\p{Lu}{2}/u.test(t) && t === t.toUpperCase() && !NR_ITEM_RE.test(t) && !/^ANEXO/.test(t);
}
// Cabeçalho de anexo que ANEXO_RE/ANEXO_DA_NR_RE não reconhecem. Caixa alta ("ANEXO “A”" NR-15.txt:1707,
// "ANEXO I da NR-09" NR-09.txt:99) ou "Anexo X"/"Anexo X da NR-xx" fora da forma exata (ex.: "Anexo A").
// Linhas em caixa mista que só COMEÇAM com "Anexo" são, no texto real, continuação de frase ("Anexo C." NR-15.txt:1696; "Anexo 1 e no item 6 do mesmo
// Anexo." NR-15.txt:5719) ou entrada de sumário ("Anexo I - Termos e definições" NR-01.txt:31) e NÃO entram
// em quarentena — senão a NR-01 perderia o corpo inteiro a partir do sumário.
function looksLikeAnexoHeader(t: string): boolean {
  if (t.length > ANEXO_HEADER_MAX_CHARS) return false;
  if (/^ANEXO\b/.test(t)) return true;
  return /^Anexo\s+\S+(?:\s+da\s+NR[\s-]?\d+)?$/i.test(t) && !/[.;,:]$/.test(t);
}

// Artigo no início da linha. Formas reais do Planalto: "Art. 1º", "Art. 1o", "Art. 64.", "Art.194 - O direito",
// "Art .193 - São", "Art. . 189 -" (ponto duplicado), "Art. 70-A.", "Art.70-G.", "Art. 4º-A". Sufixo de letra só
// COLADO no número ("193-A"): "Art. 193 - São…" é o art. 193 (hífen com espaço é pontuação, não sufixo 193-S), e
// a letra do sufixo não pode continuar uma palavra. Depois do número vem espaço, pontuação ou o fim da linha.
// Número partido por espaço e seguido de "."/"º" ("Art. 5 7. (VETADO).", LGPD: no HTML do Planalto o número está em
// dois <span>, "Art. 5" + "7.", e o espaço entre eles é renderizado) é UM número (art. 57); sem isso o art. 57 vetado
// virava um 2º "art. 5" e a colisão apagava o art. 5 verdadeiro (item_ambiguo). Os dígitos são juntados no endereço.
const LEI_ART_RE = /^Art\s*\.\s*(?:\.\s*)?(\d+(?:\s+\d+(?=[º°.]))?)(?:\s*[º°o])?(?:-([A-Z])(?![\p{L}]))?(?=[\s.:,;\-–—]|$)/u;
// "§ 1º", "§1º", "§ 4 o" (º em <sup> vira " o"), "§ 11.", "§ 1º-A" (sufixo colado), "Parágrafo único" (com ".", "-"…).
const LEI_PAR_RE = /^(?:§\s*(\d+)(?:\s*[º°o])?(?:-([A-Z])(?![\p{L}]))?|(Parágrafo único))(?=[\s.:,;\-–—]|$)/u;
// Inciso: romano + hífen/meia-risca/travessão + espaço ("I - …", "III – colisões…" — a meia-risca do Planalto é o byte
// 0x96 do windows-1252, ver decodeHtmlBuffer). Alíneas ("a)") ficam no texto do pai.
const LEI_INC_RE = /^([IVXLC]+)\s*[-–—]\s/;
// Dispositivo cujo texto (depois do endereço) é só nota de revogação/veto — "Art. 70. (Revogado pelo Decreto nº 10.410,
// de 2020).", "§ 2º (VETADO).", "III - ; (Revogado pela Lei…)": NÃO vira dispositivo (não há texto vigente a citar),
// mas encerra o dispositivo anterior, para a nota não ser lida como parte dele.
const SO_NOTAS_RE = /^[\s.,;:\-–—]*(?:\([^()]*\)[\s.,;]*)+$/;
const NOTA_REVOGACAO_RE = /\(\s*(?:Revogad[oa]|Suprimid[oa]|Vetad[oa]|Fica sem efeito)/i;
const soRevogacao = (resto: string) => SO_NOTAS_RE.test(resto) && NOTA_REVOGACAO_RE.test(resto);
// Cabeçalho de divisão ("SEÇÃO XIV", "Subseção IV-A", "CAPÍTULO V", "TÍTULO II", "LIVRO I"), sozinho na linha: encerra o
// dispositivo aberto; ele e o título que vem depois ("DA PREVENÇÃO DA FADIGA") não entram em nenhum literal.
const LEI_DIVISAO_RE = /^(?:LIVRO|Livro|TÍTULO|Título|CAPÍTULO|Capítulo|SEÇÃO|Seção|SUBSEÇÃO|Subseção)\s+[IVXLC]+(?:-[A-Z])?\s*$/;
// Cauda do documento (depois de algum artigo): fórmula de assinatura ("Brasília, em 24 de julho de 1991; 170º da
// Independência e 103º da República.", Lei 8.213), aviso do Planalto ("Este texto não substitui o publicado no DOU…") e
// cabeçalho de anexo em caixa alta ("ANEXO" depois do art. 922 da CLT; "A N E X O I" depois do art. 382 do Decreto
// 3.048). Encerra o dispositivo aberto e o texto seguinte não vira dispositivo: sem isso, o último artigo levava as
// assinaturas, o aviso e o anexo inteiro (CLT art. 922 com 24 334 caracteres). Assinatura e aviso também aparecem no
// PREÂMBULO (o decreto que aprova a CLT/o Regulamento tem artigos próprios, assinatura e aviso antes do texto
// aprovado): por isso o próximo artigo RETOMA o parser; depois de cabeçalho de anexo nada mais retoma. Trecho que vai
// até o fim do texto sem retomar vira a anomalia 'cauda_nao_classificada'.
const LEI_CAUDA_RE = [/^(?:Brasília|Rio de Janeiro)\s*,.*\bda Independência e \d+\s*[º°o]?\s*da República\.?$/, /^Este texto não substitui\b/];
const LEI_ANEXO_RE = /^(?:ANEXO|A N E X O)(?:\s+(?:[IVXLC]+|\d+|ÚNICO))?(?:\s*[-–—].*)?$/;
const CAUDA_DETALHE_MAX = 60;

// Dispositivo cujo conteúdo (depois do endereço) é só revogação/veto/supressão/inconstitucionalidade: com parênteses
// ("Art. 70. (Revogado pelo Decreto nº 10.410, de 2020).", "§ 4 o (Declarado inconstitucional pela ADI 5766)") ou sem
// ("I - revogado; (Redação dada…)", "§ 2 o Revogado. (Redação dada…)", CLT arts. 235-D, 432, 433). O parser 'lei'
// ainda cria dispositivo para a forma sem parênteses (é texto da fonte); quem LIGA regra a dispositivo usa isto para
// recusar a ligação (db/import-normative-rules.ts). Texto que só MENCIONA revogação ("Revogam-se as disposições…",
// "Fica revogado o art. 8º.") não é revogado.
const ENDERECO_RES = [LEI_ART_RE, LEI_PAR_RE, LEI_INC_RE, /^\d{1,3}(?:\.\d+)*\.?(?=\s)/, /^[a-z]\)/];
const NOTA_REVOGADO_RE = /\(\s*(?:Revogad[oa]|Suprimid[oa]|Vetad[oa]|Fica sem efeito|Declarad[oa] inconstitucional)/i;
const PALAVRA_REVOGADO_RE = /^(?:revogad[oa]s?|vetad[oa]s?|suprimid[oa]s?)(?![\p{L}])/iu;
const SO_NOTAS_FIM_RE = /^[\s.,;:\-–—]*(?:\([^()]*\)[\s.,;]*)*$/;
export function isRevokedLiteral(literal: string): boolean {
  const t = literal.replace(/\s+/g, ' ').trim();
  const endereco = ENDERECO_RES.map((re) => re.exec(t)).find((m) => m !== null);
  const resto = (endereco ? t.slice(endereco[0].length) : t).replace(/^[\s.,;:\-–—]+/, '');
  const palavra = PALAVRA_REVOGADO_RE.exec(resto);
  if (palavra) return SO_NOTAS_FIM_RE.test(resto.slice(palavra[0].length));
  return resto.startsWith('(') && SO_NOTAS_FIM_RE.test(resto) && NOTA_REVOGADO_RE.test(resto);
}

function normalizeAnexo(raw: string): string {
  return /^[IVXLC]+$/i.test(raw) ? String(romanToInt(raw.toUpperCase())) : raw.toUpperCase();
}

interface Line {
  text: string;
  start: number;
}

function splitLines(raw: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  for (const part of raw.split('\n')) {
    lines.push({ text: part, start: pos });
    pos += part.length + 1;
  }
  return lines;
}

interface Candidate extends ParsedProvision {
  line: number;
}

interface Open {
  anexo: string;
  item_path: string;
  start: number;
  line: number;
}

function isChild(parent: string, child: string): boolean {
  return child.startsWith(`${parent}.`) || child.startsWith(`${parent} `);
}

// O parser trabalha em unidades UTF-16 (índices de string JS): rawText.slice(char_start, char_end) === literal_text.
// O que é GRAVADO em normative_provisions são offsets 0-based em PONTOS DE CÓDIGO Unicode — compatíveis com
// `substring(raw_text from char_start + 1 for char_end - char_start)` do PostgreSQL e com o fatiamento de str do Python.
// Diferem quando há caractere astral (par substituto, ex.: '𝑀' U+1D440 nas fórmulas do Anexo 3 da NR-15, NR-15.txt:203).
// Converte cada offset UTF-16 descontando os pares que começam ANTES dele. Uma passada no texto + busca binária.
export function toCodePointOffsets(text: string, utf16Offsets: number[]): number[] {
  const pares: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        pares.push(i);
        i++;
      }
    }
  }
  if (pares.length === 0) return [...utf16Offsets];
  return utf16Offsets.map((off) => {
    // Quantidade de pares com início < off (o offset logo após um par conta o par; um offset no meio do par também).
    let lo = 0;
    let hi = pares.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pares[mid] < off) lo = mid + 1;
      else hi = mid;
    }
    return off - lo;
  });
}

export function parseProvisions(rawText: string, kind: ParserKind): ParseResult {
  const lines = splitLines(rawText);
  const candidates: Candidate[] = [];
  const anomalies: ParseAnomaly[] = [];
  const seenAnexos = new Set<string>();
  // Rótulo dos candidatos (`<anexo>` ou `<anexo>/<TÍTULO>`) e último anexo reconhecido como NOVO (pai das seções).
  let anexo = '';
  let anexoPai = '';
  interface Seg {
    id: string;
    kind: 'anexo' | 'secao' | 'quarentena';
    header_line: number;
    header: string;
    start: number;
    end: number;
    // Itens abertos dentro do trecho (antes da resolução de colisões).
    begins: number;
  }
  const segs: Seg[] = [{ id: '', kind: 'anexo', header_line: 0, header: '', start: 0, end: rawText.length, begins: 0 }];
  let seg: Seg = segs[0];
  const startSeg = (next: Omit<Seg, 'end' | 'begins'>) => {
    seg.end = next.start;
    seg = { ...next, end: rawText.length, begins: 0 };
    segs.push(seg);
  };
  const nextNonEmpty = (idx: number): string => {
    for (let j = idx + 1; j < lines.length; j++) {
      const t = lines[j].text.trim();
      if (t !== '') return t;
    }
    return '';
  };
  const prevNonEmpty = (idx: number): string => {
    for (let j = idx - 1; j >= 0; j--) {
      const t = lines[j].text.trim();
      if (t !== '') return t;
    }
    return '';
  };
  let open: Open | null = null;
  let artAtual = '';
  let parAtual = '';
  // Parser 'lei': algum artigo já apareceu (a cauda só vale depois dele); início da cauda atual (null fora dela) e se
  // ela já passou por cabeçalho de anexo (aí nada mais retoma).
  let artVisto = false;
  let cauda: { line: number; start: number; header: string } | null = null;
  let caudaAnexo = false;

  const close = (endExclusive: number) => {
    if (!open) return;
    const literal = rawText.slice(open.start, endExclusive).replace(/\s+$/, '');
    if (literal.length > 0) {
      candidates.push({
        anexo: open.anexo,
        item_path: open.item_path,
        heading: null,
        literal_text: literal,
        char_start: open.start,
        char_end: open.start + literal.length,
        line: open.line,
      });
    }
    open = null;
  };

  const begin = (item_path: string, line: Line, lineNo: number) => {
    open = { anexo, item_path, start: line.start, line: lineNo };
    seg.begins++;
  };

  lines.forEach((line, idx) => {
    const t = line.text.trim();
    const lineNo = idx + 1;

    if (kind === 'nr') {
      const anexoMatch = ANEXO_RE.exec(t) ?? ANEXO_DA_NR_RE.exec(t);
      const novo = anexoMatch ? normalizeAnexo(anexoMatch[1]) : ANEXO_SEM_NUMERO_RE.test(t) ? '(*)' : null;
      if (novo !== null || looksLikeAnexoHeader(t)) {
        close(line.start);
        if (novo !== null && !seenAnexos.has(novo)) {
          seenAnexos.add(novo);
          anexo = novo;
          anexoPai = novo;
          startSeg({ id: novo, kind: 'anexo', header_line: lineNo, header: t, start: line.start });
          return;
        }
        // Sub-anexo, repetição ou cabeçalho não reconhecido: tudo até o próximo anexo NOVO ou seção fica fora.
        anomalies.push(
          novo !== null
            ? { kind: 'anexo_repetido', line: lineNo, detail: novo }
            : { kind: 'anexo_nao_reconhecido', line: lineNo, detail: t },
        );
        startSeg({ id: '', kind: 'quarentena', header_line: lineNo, header: t, start: line.start });
        return;
      }
      // Seção só abre dentro de um anexo, e só depois de algum item do trecho atual (ou saindo da quarentena):
      // assim o título do próprio anexo ("ASBESTO" logo após o título do Anexo 12) não vira seção.
      if (
        anexoPai !== '' &&
        (seg.kind === 'quarentena' || seg.begins > 0) &&
        isSectionTitle(t) &&
        SECAO_NOTA_RE.test(nextNonEmpty(idx))
      ) {
        close(line.start);
        if (isUpperTitleLine(prevNonEmpty(idx))) return;
        anexo = `${anexoPai}/${t}`;
        startSeg({ id: anexo, kind: 'secao', header_line: lineNo, header: t, start: line.start });
        return;
      }
      if (seg.kind === 'quarentena') return;
      const m = NR_ITEM_RE.exec(t);
      if (m) {
        close(line.start);
        begin(m[1].replace(/\.$/, ''), line, lineNo);
      }
      return;
    }

    if (caudaAnexo) return;
    const anexoFim = LEI_ANEXO_RE.test(t);
    if (artVisto && (anexoFim || LEI_CAUDA_RE.some((re) => re.test(t)))) {
      close(line.start);
      cauda ??= { line: lineNo, start: line.start, header: t };
      caudaAnexo = anexoFim;
      return;
    }
    if (cauda && !LEI_ART_RE.test(t)) return;
    cauda = null;
    if (LEI_DIVISAO_RE.test(t)) {
      close(line.start);
      artAtual = '';
      parAtual = '';
      return;
    }
    const art = LEI_ART_RE.exec(t);
    if (art) {
      close(line.start);
      artVisto = true;
      artAtual = `art. ${art[1].replace(/\s+/g, '')}${art[2] ? `-${art[2]}` : ''}`;
      parAtual = '';
      if (!soRevogacao(t.slice(art[0].length))) begin(artAtual, line, lineNo);
      return;
    }
    const par = LEI_PAR_RE.exec(t);
    if (par && artAtual) {
      close(line.start);
      parAtual = par[3] ? `${artAtual} §único` : `${artAtual} §${par[1]}${par[2] ? `-${par[2]}` : ''}`;
      if (!soRevogacao(t.slice(par[0].length))) begin(parAtual, line, lineNo);
      return;
    }
    const inc = LEI_INC_RE.exec(t);
    if (inc && artAtual) {
      close(line.start);
      if (!soRevogacao(t.slice(inc[0].length))) begin(`${parAtual || artAtual} inc. ${inc[1]}`, line, lineNo);
    }
  });
  close(rawText.length);
  // (o TS estreita `cauda` para null: só é atribuída dentro do callback do forEach)
  const caudaFinal = cauda as { line: number; start: number; header: string } | null;
  if (caudaFinal) {
    const { header, line, start } = caudaFinal;
    const cab = header.length > CAUDA_DETALHE_MAX ? `${header.slice(0, CAUDA_DETALHE_MAX)}…` : header;
    anomalies.push({ kind: 'cauda_nao_classificada', line, detail: `${cab} (${rawText.length - start} caracteres sem dispositivo)` });
  }

  // Colisão de chave (mesmo anexo + item), regra ESTRUTURAL ESTRITA. "Vencedora" é a ocorrência cujo
  // próximo candidato (mesmo anexo) é filho dela. Grava só se há exatamente 1 vencedora e todas as outras
  // ocorrências são curtas e vêm ANTES dela (títulos do sumário); as demais viram item_repetido. Qualquer
  // outro caso é item_ambiguo e NENHUMA ocorrência grava. Ocorrência única sempre grava.
  const isWinner = (i: number): boolean => {
    const c = candidates[i];
    const next = candidates[i + 1];
    return !!next && next.anexo === c.anexo && isChild(c.item_path, next.item_path);
  };
  const groups = new Map<string, number[]>();
  candidates.forEach((c, i) => {
    const key = `${c.anexo}\u0000${c.item_path}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const provisions: ParsedProvision[] = [];
  const strip = ({ line: _line, ...p }: Candidate): ParsedProvision => p;
  for (const group of groups.values()) {
    if (group.length === 1) {
      provisions.push(strip(candidates[group[0]]));
      continue;
    }
    const winners = group.filter(isWinner);
    const w = winners.length === 1 ? candidates[winners[0]] : null;
    const others = group.filter((i) => i !== winners[0]).map((i) => candidates[i]);
    if (w && others.every((o) => o.literal_text.length <= TOC_MAX_CHARS && o.char_start < w.char_start)) {
      provisions.push(strip(w));
      others.forEach((o) => anomalies.push({ kind: 'item_repetido', line: o.line, detail: o.item_path }));
    } else {
      const first = candidates[group[0]];
      anomalies.push({ kind: 'item_ambiguo', line: first.line, detail: `${first.item_path} (${group.length}x)` });
    }
  }
  provisions.sort((a, b) => a.char_start - b.char_start);

  const covered = provisions.reduce((s, p) => s + (p.char_end - p.char_start), 0);
  // Seção sem nenhum item (título seguido de nota, mas sem item até o próximo cabeçalho) não é entrada própria:
  // o trecho volta para o trecho anterior (anexo, seção ou quarentena), contíguo a ela.
  const merged: Seg[] = [];
  for (const g of segs) {
    if (g.kind === 'secao' && g.begins === 0 && merged.length > 0) merged[merged.length - 1].end = g.end;
    else merged.push(g);
  }
  const anexos: ParsedAnexo[] = merged
    .filter((g) => g.kind !== 'quarentena' && (g.id !== '' || g.end > g.start))
    .map((g) => {
      const doAnexo = provisions.filter((p) => p.anexo === g.id);
      return {
        id: g.id,
        header_line: g.header_line,
        provisions: doAnexo.length,
        chars: g.end - g.start,
        covered_chars: doAnexo.reduce((s, p) => s + (p.char_end - p.char_start), 0),
      };
    });
  return {
    provisions,
    anomalies,
    total_chars: rawText.length,
    covered_chars: covered,
    coverage: rawText.length === 0 ? 0 : covered / rawText.length,
    anexos,
    quarantines: merged
      .filter((g) => g.kind === 'quarentena')
      .map((g) => ({ header_line: g.header_line, header: g.header, chars: g.end - g.start })),
  };
}
