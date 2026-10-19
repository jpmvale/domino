import { Gaveta } from '../components/Gaveta';

/** As regras, acessíveis a qualquer momento sem sair da mesa. */
export function Regras({ aoFechar }: { aoFechar: () => void }) {
  return (
    <Gaveta titulo="Como se joga" aoFechar={aoFechar}>
      <div className="pilha" style={{ gap: 14, fontSize: 15 }}>
        <section className="pilha" style={{ gap: 6 }}>
          <span className="rotulo">o básico</span>
          <p>São 28 pedras, do 0:0 ao 6:6. Cada pessoa recebe 7. Com 2 ou 3 jogadores, o que sobra vira monte de compra.</p>
          <p>Na primeira mão começa quem tem a maior carroça (a 6:6), jogando ela. Nas seguintes, começa quem venceu a anterior.</p>
          <p>Na sua vez, encaixe uma pedra numa ponta com o mesmo número. Sem pedra que sirva, você compra do monte até conseguir; sem monte, passa a vez. Isso acontece sozinho.</p>
          <p>A mão acaba quando alguém <strong>bate</strong> (fica sem pedras) ou quando o jogo <strong>tranca</strong> (ninguém consegue jogar).</p>
          <p>Com 4 pessoas, o padrão é jogar em duplas: quem senta de frente é parceiro.</p>
        </section>
        <section className="pilha" style={{ gap: 6 }}>
          <span className="rotulo">modo batida</span>
          <p>Só o fim da mão pontua:</p>
          <ul style={{ paddingLeft: 20 }}>
            <li>Batida simples: 1 ponto</li>
            <li>Batida de carroça: 2 pontos</li>
            <li>Lá-e-lô (a última pedra servia nas duas pontas): 3 pontos</li>
            <li>Cruzada (lá-e-lô de carroça): 4 pontos</li>
          </ul>
          <p>No jogo trancado, soma-se o que sobrou na mão de cada um (ou de cada dupla). A menor soma leva 1 ponto. Empate: perde quem trancou.</p>
        </section>
        <section className="pilha" style={{ gap: 6 }}>
          <span className="rotulo">modo múltiplo de 5</span>
          <p>Depois de cada jogada somam-se as pontas abertas. Se der múltiplo de 5, quem jogou marca a soma (pontas 6 e 4 dão 10 pontos).</p>
          <p>Carroça na ponta conta as duas metades: um 5:5 na ponta vale 10.</p>
          <p>Bater ou trancar não vale nada: a mão recomeça e ninguém ganha ponto por isso.</p>
          <p>Com "carroças abrem" ligado, a primeira carroça da mão é comum, mas as seguintes abrem as laterais e viram três pontas. Enquanto nada encosta nela, a carroça conta o dobro; depois, cada lado livre vale o número dela.</p>
        </section>
      </div>
    </Gaveta>
  );
}
