-- Teste de banco (ensaio descartável; tudo em transação com ROLLBACK). Esperado: 4 linhas, todas "t".
-- Uso: psql -At -v ON_ERROR_STOP=1 -d <banco com 0108+0109+0110+0111> -f este_arquivo
BEGIN;
INSERT INTO tenants (name, cnpj, status) VALUES ('T Montese','11111111000111','ativo') RETURNING id \gset m_
INSERT INTO users (role, email, password_hash, full_name, status) VALUES ('socio','s@t.invalid','x','Socia T','ativo') RETURNING id \gset s_
INSERT INTO users (role, email, password_hash, full_name, status, account_type) VALUES ('tecnico','t@t.invalid','x','Tec T','ativo','assinante') RETURNING id \gset t_
INSERT INTO socio_permissions (user_id, permission) VALUES (:'s_id','empresas.atuar');
INSERT INTO tenants (name, cnpj, status, kind, owner_technician_id) VALUES ('T Assinante','22222222000122','ativo','tecnico_proprio',:'t_id') RETURNING id \gset a_
SELECT set_config('app.role','socio',true), set_config('app.user_id',:'s_id',true) \gset
SELECT 'montese_normal_permitida' AS caso, socio_can_act_on_tenant(:'s_id',:'m_id') AS ok;
SELECT 'assinante_negada' AS caso, NOT socio_can_act_on_tenant(:'s_id',:'a_id') AS ok;
SELECT 'sem_papel_socio_negada' AS caso, NOT (SELECT socio_can_act_on_tenant(:'s_id',:'m_id') FROM (SELECT set_config('app.role','empresa',true)) x) AS ok;
SELECT set_config('app.role','socio',true) \gset
SELECT 'assinante_ativo_com_permissao_continua_negada' AS caso, NOT socio_can_act_on_tenant(:'s_id',:'a_id') AS ok;
ROLLBACK;
