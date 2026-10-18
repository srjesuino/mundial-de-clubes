# Mundial de Clubes 64

Simulador de torneio de clubes de futebol que roda no navegador (computador ou celular, inclusive offline depois da primeira visita).
Você monta as regras, escolhe até 8 clubes e joga as partidas deles ao vivo, nos minigames, ou deixa o simulador decidir.

## O que dá para fazer

- **Formatos:** fase de grupos (turno único ou ida e volta, com mando de campo), pontos corridos, sistema suíço, mata-mata com sorteio a cada fase e dupla eliminação (upper/lower bracket).
- **Partida ao vivo:** chances de ataque e defesa, prorrogação e disputa de pênaltis com as regras oficiais, em quatro níveis de dificuldade.
- **Postura tática:** Retranca, Equilibrado ou Ofensivo, antes e durante o jogo. A regra é uma só e vale para os dois lados: Ofensivo aumenta em 30% os gols esperados dos dois times e Retranca diminui em 25%. O favorito ganha com jogo aberto e o azarão com jogo fechado.
- **Chance ao vivo:** gráfico minuto a minuto com a chance de vencer (ou de avançar) se o resto do jogo fosse simulado, além da "prancheta", que mostra essa chance em cada postura.
- **Probabilidades do torneio:** milhares de simulações do restante do torneio com o mesmo motor, cenários do próximo jogo ("se vencer / empatar / perder") e classificação ou eliminação matemática.
- **Plantão da rodada:** o placar de todos os jogos minuto a minuto, com a classificação parcial.
- **Galeria de Campeões, Índice de Superação e conquistas:** ficam guardados no navegador entre um torneio e outro. Também dá para copiar um resumo do torneio e pedir Revanche.
- **Acessibilidade:** teclado completo (inclusive nos minigames), narração para leitor de tela, opção de reduzir animações, som sintetizado (sem arquivos de áudio) e vibração.

## Princípio: números honestos

Todo número mostrado sai do mesmo motor que decide os jogos. Não há bônus escondido nem "sorte" do lado do usuário:

- Os gols seguem uma distribuição de Poisson. Os gols esperados de cada time são `1,3 × e^(0,042 × diferença de OVR)`, com mando de campo de 10% só nos grupos de ida e volta.
- As probabilidades antes do jogo e ao vivo são calculadas de forma exata a partir desse modelo. Os testes conferem que elas batem com milhares de simulações.
- A dificuldade só muda os minigames; o botão Simular e as probabilidades não mudam.
- Recarregar a página no meio de um jogo não permite "rejogar": o simulador termina a partida a partir do placar salvo.
- A Superação usa as chances com posturas neutras, então não dá para inflá-la escolhendo postura.

## Desenvolvimento

Requisitos: Node 20 ou mais recente.

```bash
npm install
npm run dev          # servidor de desenvolvimento
npm test             # testes do motor (Vitest)
npm run build        # checagem de tipos + build de produção em dist/
npm run test:e2e     # testes de ponta a ponta (Playwright) sobre o build
```

Estrutura:

- `src/engine/`: motor puro, sem acesso a tela: modelo de partida, formatos, sorteios, previsão (Monte Carlo), Superação e conquistas.
- `src/state/`: torneio salvo, preferências e dados que sobrevivem entre torneios (galeria e conquistas).
- `src/ui/`: telas e componentes, em TypeScript sem framework.
- `tests/unit/`: invariantes de todos os formatos e conferência das probabilidades.
- `tests/e2e/`: torneios completos pela interface, partida ao vivo só pelo teclado, celular e armazenamento bloqueado.
- `tests/pwa/`: o build do GitHub Pages com service worker de verdade (sub-caminho, uso offline).

## Publicação

O site é servido pelo GitHub Pages a partir do branch **`gh-pages`** (Settings → Pages → *Deploy from a branch* → `gh-pages` / root), em https://srjesuino.github.io/mundial-de-clubes/.

- A cada push na `main`, o workflow `.github/workflows/deploy.yml` roda tipos, testes, build e testes de ponta a ponta e atualiza o `gh-pages`.
- Sem o Actions disponível, `npm run publish:pages` faz o mesmo à mão: testes do motor, build com o caminho do repositório (`BASE=/<repositório>/`) e envio para o `gh-pages`.

Versões novas nunca recarregam a página no meio de uma partida: aparece o botão ⟳ no topo, e a troca só acontece sozinha quando não há nada em andamento.

Os escudos dos clubes são carregados de um servidor público. Quando uma imagem não carrega, o jogo desenha um escudo com as iniciais.

---

Projeto de fã, sem vínculo com FIFA, EA ou com os clubes. Os resultados são gerados pelo simulador e não são jogos reais.
