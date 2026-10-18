// Ganchos chamados depois de avançar de rodada (previsão do torneio, tela de campeão etc.)
type Hook = () => void;
const after: Hook[] = [];
export const onAfterAdvance = (fn: Hook): void => { after.push(fn); };
export const afterAdvance = (): void => after.forEach(fn => fn());
