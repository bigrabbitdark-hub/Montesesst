// ITEM 003 (auditoria 2026-09-27): minimização de PII antes de enviar texto
// de documento/transcrição a provedores externos de IA (OpenRouter/MiniMax).
// Não é anonimização perfeita — é a mesma filosofia de minimização já
// aplicada em ATTENTION_TIPO_AI_SAFE (dashboard.service.ts): reduzir o que
// sai pro provedor externo, sem exigir NLP/NER (nova dependência pesada,
// contra a regra de não instalar biblioteca sem necessidade real).
//
// Duas estratégias, cada uma cobrindo o que a outra não cobre:
// 1. CPF: formato estruturado, detectável por regex com confiança alta.
// 2. Nome completo: sem NER, a única fonte confiável de "isto é um nome"
//    é o próprio cadastro de funcionários do tenant — por isso as funções
//    abaixo recebem a lista de nomes já cadastrados, em vez de tentar
//    adivinhar nomes genéricos no texto (o que geraria falsos positivos
//    /negativos sem controle).

const CPF_RE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11}\b/g;

export function redactCpf(text: string): string {
  return text.replace(CPF_RE, '[CPF removido]');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// (?<![\p{L}])...(?![\p{L}]) em vez de \b: \b no JS não reconhece letra
// acentuada como "caractere de palavra", então "José" no meio de uma frase
// acentuada poderia não casar corretamente com \b. \p{L} (com flag u) cobre
// letra em qualquer alfabeto, inclusive acentuada.
export function redactKnownNames(text: string, fullNames: string[]): string {
  let result = text;
  for (const rawName of fullNames) {
    const name = rawName.trim();
    // Nomes muito curtos (ex.: iniciais, "Jo") geram falso positivo alto
    // demais pra valer a pena redigir.
    if (name.length < 4) continue;
    // Cada trecho do nome é separado por \s+ (não por espaço literal): texto
    // extraído de PDF quebra linha no meio de nomes ("Maria Aparecida\nSouza"),
    // e um espaço literal não casaria. Hifenização ("Apare-\ncida") continua
    // fora do alcance desta redação.
    const namePattern = name.split(/\s+/).map(escapeRegex).join('\\s+');
    const pattern = new RegExp(`(?<![\\p{L}])${namePattern}(?![\\p{L}])`, 'giu');
    result = result.replace(pattern, '[nome removido]');
  }
  return result;
}

export function redactPii(text: string, knownFullNames: string[] = []): string {
  return redactKnownNames(redactCpf(text), knownFullNames);
}
