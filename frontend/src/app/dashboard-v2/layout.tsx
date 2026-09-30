import { RoleGuard } from '@/components/RoleGuard';

// Rota paralela de pré-visualização do novo dashboard "Início" (Fase 1). Fica
// fora de /empresa para não herdar o layout/sidebar atuais, que continuam
// intactos até a Fase 2 trazer o conteúdo real. Mesma guarda de papel de /empresa.
export default function DashboardV2Layout({ children }: { children: React.ReactNode }) {
  return <RoleGuard allow={['empresa']}>{children}</RoleGuard>;
}
