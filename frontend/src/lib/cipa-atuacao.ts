// Ruling 25: a gestão da CIPA precisa de um usuário DA EMPRESA como responsável (responsavel_user_id do
// tenant). No modo atuação o usuário é a sócia, que não pertence à empresa — o backend recusaria.
export const MSG_CIPA_NOVA_GESTAO_ATUANDO =
  'Criar uma nova gestão da CIPA exige um usuário da empresa como responsável. Saia do modo empresa e peça ao RH da empresa, ou crie a gestão pelo painel do RH.';
