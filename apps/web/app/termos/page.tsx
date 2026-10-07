import type { Metadata } from "next";
import Link from "next/link";
import { TERMS_DATE_LABEL, termsCompany } from "@/lib/terms";

export const metadata: Metadata = { title: "Termos de uso — Achadinhos Bot" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function TermosPage() {
  const company = termsCompany();
  const contact = company.email ? (
    <>
      pelo e-mail <strong>{company.email}</strong>
    </>
  ) : (
    "pelos canais de suporte informados no painel"
  );
  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-10 text-sm leading-relaxed">
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold">Termos de uso do Achadinhos Bot</h1>
        <p className="text-muted-foreground">
          Versão de {TERMS_DATE_LABEL}. Serviço prestado por {company.name}
          {company.document ? `, inscrição ${company.document}` : ""}.
        </p>
      </header>

      <div role="note" className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-50">
        <p className="font-semibold">Atenção: risco de banimento no WhatsApp</p>
        <p>
          O Achadinhos Bot conecta o SEU número ao WhatsApp como um aparelho conectado (como o WhatsApp Web). Não é a API oficial
          do WhatsApp e não tem relação com a Meta. O WhatsApp pode restringir ou banir números que enviam muitas mensagens,
          mesmo respeitando os limites e o aquecimento do painel. Use um número que você aceite arriscar. Não garantimos que o
          seu número não será banido e não respondemos pela perda do número, de conversas, de grupos ou de vendas.
        </p>
      </div>

      <Section title="1. O que é o serviço">
        <p>
          Painel para encontrar ofertas, gerar links de afiliado com as SUAS credenciais das lojas (Shopee, Mercado Livre,
          Amazon, Shein e outras) e divulgar essas ofertas nos seus grupos de WhatsApp, manualmente ou pelo piloto
          automático, além de relatórios. As comissões são pagas pelas lojas, nas suas contas de afiliado, e não por nós.
        </p>
      </Section>

      <Section title="2. Cadastro e conta">
        <p>
          Você precisa informar dados verdadeiros e manter a senha em segredo. Cada conta é de um negócio; o dono da conta
          responde pelo uso feito por ela. Podemos suspender contas usadas para fraude, spam ou em desacordo com estes termos.
        </p>
      </Section>

      <Section title="3. Uso do WhatsApp: suas responsabilidades">
        <ul className="list-disc space-y-1 pl-5">
          <li>Use um número seu e envie só para grupos que você administra ou onde tem permissão para divulgar.</li>
          <li>Não envie spam, mensagens a quem não quer receber nem conteúdo proibido pelos termos do WhatsApp ou pela lei.</li>
          <li>
            Os limites do painel (aquecimento de número novo, mensagens por dia, intervalo entre grupos) reduzem o risco, mas
            não o eliminam. A decisão de banir ou restringir é só do WhatsApp.
          </li>
          <li>Se o WhatsApp desconectar ou banir o número, o painel pausa os envios daquele número.</li>
        </ul>
      </Section>

      <Section title="4. Programas de afiliados e ofertas">
        <p>
          Cada loja tem regras próprias para afiliados; cumpri-las é sua responsabilidade. Preço, estoque e condições das
          ofertas são das lojas e podem mudar a qualquer momento. As informações do catálogo e das mensagens são lidas das
          lojas e podem conter erros: confira antes de divulgar quando for importante.
        </p>
      </Section>

      <Section title="5. Teste grátis, planos e cobrança">
        <ul className="list-disc space-y-1 pl-5">
          <li>Todo cadastro começa com 7 dias de teste grátis no plano Iniciante.</li>
          <li>
            Os planos são cobrados por mês ou por ano, com renovação automática, pelo Asaas (Pix, boleto ou cartão). Os dados
            do cartão são digitados na página do Asaas e nunca passam pelo nosso sistema.
          </li>
          <li>
            Os limites de cada plano (números, grupos, ofertas por dia, relatórios) estão na página Assinatura e são
            aplicados pelo sistema.
          </li>
          <li>
            Subir de plano: você paga a diferença proporcional aos dias que faltam do período, e o plano novo libera quando
            essa cobrança é paga. Descer de plano ou trocar entre mensal e anual: vale a partir do próximo vencimento.
          </li>
        </ul>
      </Section>

      <Section title="6. Atraso no pagamento">
        <p>
          Se o teste grátis terminar sem pagamento, os envios aos grupos ficam pausados até o primeiro pagamento. Se uma
          mensalidade ou anuidade atrasar mais de 5 dias, os envios também são pausados até o pagamento. Nada é apagado:
          catálogo, configurações, grupos e relatórios continuam na sua conta, e os envios voltam assim que o pagamento é
          confirmado.
        </p>
      </Section>

      <Section title="7. Cancelamento">
        <p>
          Você pode cancelar quando quiser na página Assinatura. A cobrança recorrente é cancelada na hora (não há nova
          cobrança) e você usa o plano até o fim do período já pago. Fora o direito de arrependimento (item 8), não há
          devolução proporcional do período em curso.
        </p>
      </Section>

      <Section title="8. Direito de arrependimento (art. 49 do Código de Defesa do Consumidor)">
        <p>
          Como a contratação é feita pela internet, você pode desistir em até 7 dias corridos contados do primeiro pagamento
          de um plano (ou da contratação, o que for depois). Nesse caso devolvemos integralmente o valor pago, pelo mesmo
          meio de pagamento, e a assinatura é encerrada. Para pedir, fale conosco {contact} dentro do prazo.
        </p>
      </Section>

      <Section title="9. Dados pessoais (LGPD)">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Tratamos os dados necessários para o serviço: cadastro (nome, e-mail), dados de cobrança, a sessão do WhatsApp
            (guardada criptografada), seus grupos, as ofertas e mensagens enviadas e as credenciais de afiliado (guardadas
            criptografadas).
          </li>
          <li>
            O CPF/CNPJ é enviado só ao Asaas para emitir as cobranças; no nosso sistema ficam apenas os 4 últimos dígitos.
          </li>
          <li>
            Cliques nos links contados pelo painel não guardam o endereço IP de quem clicou (só uma marca irreversível usada
            para não contar cliques repetidos).
          </li>
          <li>
            Você pode pedir acesso, correção ou exclusão dos seus dados {contact}. Dados que a lei obriga a guardar (por
            exemplo, de cobrança) são mantidos pelo prazo legal.
          </li>
        </ul>
      </Section>

      <Section title="10. Disponibilidade e limites de responsabilidade">
        <p>
          Trabalhamos para manter o serviço no ar, mas ele depende de terceiros (WhatsApp, lojas, Asaas, provedores de
          internet e hospedagem) e pode ficar indisponível. Na máxima extensão permitida pela lei, não respondemos por lucros
          ou comissões que deixaram de ser ganhos, nem por decisões das lojas ou do WhatsApp.
        </p>
      </Section>

      <Section title="11. Mudanças nestes termos">
        <p>
          Podemos atualizar estes termos. Quando a mudança for relevante, você verá a nova versão no painel e precisará
          aceitá-la para continuar usando.
        </p>
      </Section>

      <Section title="12. Contato e foro">
        <p>
          Dúvidas e pedidos: {contact}. Fica eleito o foro do domicílio do consumidor, conforme o Código de Defesa do
          Consumidor.
        </p>
      </Section>

      <p>
        <Link href="/cadastro" className="underline underline-offset-4">
          Voltar ao cadastro
        </Link>
      </p>
    </main>
  );
}
