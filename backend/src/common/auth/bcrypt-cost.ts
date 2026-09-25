// Cost factor do bcrypt usado em TODA a aplicação (cadastro de usuário,
// cadastro de técnico, criação de parceiro, seed).
//
// OWASP 2024 recomenda cost >= 12 para novas implantações. Em hardware
// modesto (CPU 2024) 12 rounds adiciona ~50ms por signup — aceitável.
// NÃO usar >13 sem benchmarking local em produção: em VPS ARM Cortex-A
// pode chegar a 200ms+ por hash.
//
// Aumento do cost NÃO invalida hashes existentes — bcrypt codifica o
// cost no próprio hash (formato $2b$<cost>$...). Aumentar agora significa
// só que hashes NOVOS serão mais caros; login de hashes antigos continua
// funcionando sem retrabalho. Ver F-24 do
// docs/audits/security-audit-preprod.md.
//
// Single source of truth: qualquer call site novo de bcrypt.hash DEVE
// importar daqui, nunca hardcodar `10`/`12` literal. O teste unitário
// bcrypt-cost.unit-spec.ts faz varredura estática pra garantir isso.
//
// Override por env (BCRYPT_COST) existe para tunar em emergência sem
// rebuild (ex.: incidente de performance derruba CPU em prod). Em uso
// normal manter 12.
export const BCRYPT_COST: number = (() => {
  const raw = process.env.BCRYPT_COST;
  if (!raw) return 12;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 4 || parsed > 15) return 12;
  return parsed;
})();
