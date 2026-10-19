-- Documentos da categoria cadastro_funcionarios (planilha/PDF/DOCX de cadastro; podem conter ASO e dados pessoais)
-- só podem ser vistos, baixados, alterados ou apagados por empresa e admin. Técnico e parceiro vinculados ficam de fora.
--
-- Política RESTRICTIVE e independente: NÃO reescreve nem altera `documents_isolation` (0008/0011), que a produção
-- usa e pode ter variações. Políticas restritivas são combinadas por AND com as permissivas, então a regra vale
-- para TODOS os caminhos (listagem, download, portfolio, indexador, escrita), em qualquer comando.
-- Efeito colateral deliberado: contextos com app.role vazio ou desconhecido também deixam de ver SÓ essa categoria.
DROP POLICY IF EXISTS documents_hide_employee_registry ON documents;
CREATE POLICY documents_hide_employee_registry ON documents
  AS RESTRICTIVE
  FOR ALL
  USING (
    category <> 'cadastro_funcionarios'
    OR current_setting('app.role', true) IN ('empresa', 'admin')
  )
  WITH CHECK (
    category <> 'cadastro_funcionarios'
    OR current_setting('app.role', true) IN ('empresa', 'admin')
  );
