/** Erro de servidor em português de gente. Erro genérico em jogo é frustração pura. */
const FRASES: Record<string, string> = {
  NAO_E_SUA_VEZ: 'Calma, ainda não é a sua vez.',
  NAO_ENCAIXA: 'Essa pedra não encaixa aí.',
  COMECE_PELA_MAIOR: 'A primeira mão começa pela maior carroça.',
  PEDRA_NAO_E_SUA: 'Essa pedra não é sua.',
  MAO_ANTIGA: 'Essa jogada chegou atrasada.',
  PARTIDA_PAUSADA: 'A partida está pausada.',
  FALTA_PRONTO: 'Falta alguém dar pronto.',
  JOGADORES_INSUFICIENTES: 'Precisa de pelo menos 2 na mesa.',
  SO_BOTS_NA_MESA: 'Precisa de pelo menos uma pessoa na mesa.',
  MESA_CHEIA: 'A mesa está cheia (4 lugares).',
  SALA_LOTADA: 'A sala está lotada.',
  BOTS_DEMAIS: 'Já tem bot demais na mesa.',
  SILENCIADO: 'O anfitrião silenciou você no chat.',
  RAPIDO_DEMAIS: 'Devagar com o chat.',
  APELIDO_TOMADO: 'Esse apelido já está na mesa.',
  EMOJI_TOMADO: 'Esse bicho já é de alguém.',
  COR_TOMADA: 'Essa cor já é de alguém.',
  DECISAO_AINDA_BLOQUEADA: 'Ainda dá para esperar quem caiu.',
  SALAS_DEMAIS: 'Muitas salas criadas daqui. Tente mais tarde.',
  ROOM_NOT_FOUND: 'Essa sala não existe mais.',
  RATE_LIMITED: 'Muitos comandos seguidos. Respire um pouco.',
  VALIDATION_FAILED: 'Algo não bateu. Tente de novo.',
  ORDEM_INVALIDA: 'Alguém entrou ou saiu. Tente de novo.',
};

export const frase = (codigo: string): string => FRASES[codigo] ?? 'Não deu certo. Tente de novo.';
