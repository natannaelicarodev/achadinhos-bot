// Asaas em memória (sem rede): responde às rotas que o AsaasClient usa.
import { AsaasClient, type AsaasPayment } from "../src/asaas";

interface FakeSubscription {
  id: string;
  customer: string;
  value: number;
  nextDueDate: string;
  cycle: string;
  deleted: boolean;
}

export class FakeAsaas {
  customers = new Map<string, { name: string; cpfCnpj: string; email: string; externalReference: string }>();
  subscriptions = new Map<string, FakeSubscription>();
  payments = new Map<string, AsaasPayment>();
  calls: string[] = [];
  private seq = 0;
  /** Ids únicos entre instâncias (os testes dividem o mesmo banco). */
  private readonly tag = Math.random().toString(36).slice(2, 8);

  readonly client = new AsaasClient({ apiKey: "chave-teste", env: "sandbox", fetch: (input, init) => this.handle(String(input), init) });

  private next(prefix: string) {
    return `${prefix}_${this.tag}${++this.seq}`;
  }

  /** Cobrança gerada pela assinatura (como o Asaas faz para o próximo vencimento). */
  private invoice(sub: FakeSubscription): AsaasPayment {
    const payment: AsaasPayment = {
      id: this.next("pay"),
      customer: sub.customer,
      subscription: sub.id,
      status: "PENDING",
      billingType: "UNDEFINED",
      value: sub.value,
      dueDate: sub.nextDueDate,
      invoiceUrl: `https://sandbox.asaas.com/i/${this.seq}`,
      deleted: false,
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  /** Próxima cobrança da assinatura (o Asaas gera antes do vencimento). */
  nextInvoice(subscriptionId: string, day: string) {
    const sub = this.subscriptions.get(subscriptionId)!;
    sub.nextDueDate = day;
    return this.invoice(sub);
  }

  /** Simula o pagamento (como o botão do sandbox). */
  pay(id: string, day: string) {
    const p = this.payments.get(id)!;
    Object.assign(p, { status: "RECEIVED", paymentDate: day });
    return p;
  }

  overdue(id: string) {
    const p = this.payments.get(id)!;
    p.status = "OVERDUE";
    return p;
  }

  private async handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? "GET";
    const path = url.replace("https://api-sandbox.asaas.com/v3", "");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    this.calls.push(`${method} ${path.split("?")[0]}`);
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if ((init?.headers as Record<string, string>)?.access_token !== "chave-teste") return new Response("{}", { status: 401 });

    if (method === "POST" && path === "/customers") {
      if (!/^\d{11}$|^\d{14}$/.test(String(body.cpfCnpj))) {
        return new Response(JSON.stringify({ errors: [{ description: "CPF/CNPJ inválido." }] }), { status: 400 });
      }
      const id = this.next("cus");
      this.customers.set(id, body as never);
      return ok({ id });
    }
    if (method === "POST" && path === "/subscriptions") {
      const sub: FakeSubscription = {
        id: this.next("sub"),
        customer: String(body.customer),
        value: Number(body.value),
        nextDueDate: String(body.nextDueDate),
        cycle: String(body.cycle),
        deleted: false,
      };
      this.subscriptions.set(sub.id, sub);
      this.invoice(sub);
      return ok({ id: sub.id });
    }
    let m = path.match(/^\/subscriptions\/([^/?]+)$/);
    if (m) {
      const sub = this.subscriptions.get(decodeURIComponent(m[1]!))!;
      if (method === "DELETE") {
        sub.deleted = true;
        return ok({ deleted: true, id: sub.id });
      }
      sub.value = Number(body.value);
      if (body.updatePendingPayments) {
        for (const p of this.payments.values()) if (p.subscription === sub.id && p.status === "PENDING") p.value = sub.value;
      }
      return ok({ id: sub.id });
    }
    if (method === "GET" && path.startsWith("/subscriptions?")) {
      const customer = new URL(`https://x${path}`).searchParams.get("customer");
      const data = [...this.subscriptions.values()]
        .filter((x) => x.customer === customer)
        .map((x) => ({ id: x.id, customer: x.customer, value: x.value, deleted: x.deleted, status: x.deleted ? "INACTIVE" : "ACTIVE" }));
      return ok({ data });
    }
    if (method === "POST" && path === "/payments") {
      const payment: AsaasPayment = {
        id: this.next("pay"),
        customer: String(body.customer),
        subscription: null,
        status: "PENDING",
        billingType: "UNDEFINED",
        value: Number(body.value),
        dueDate: String(body.dueDate),
        invoiceUrl: `https://sandbox.asaas.com/i/${this.seq}`,
        deleted: false,
      };
      this.payments.set(payment.id, payment);
      return ok(payment);
    }
    m = path.match(/^\/payments\/([^/?]+)\/refund$/);
    if (m) {
      const p = this.payments.get(decodeURIComponent(m[1]!))!;
      p.status = "REFUNDED";
      return ok(p);
    }
    m = path.match(/^\/payments\/([^/?]+)$/);
    if (m) {
      const p = this.payments.get(decodeURIComponent(m[1]!))!;
      if (method === "DELETE") {
        p.deleted = true;
        return ok({ deleted: true });
      }
      return ok(p);
    }
    if (method === "GET" && path.startsWith("/payments?")) {
      const customer = new URL(`https://x${path}`).searchParams.get("customer");
      return ok({ data: [...this.payments.values()].filter((p) => p.customer === customer), hasMore: false });
    }
    return new Response(JSON.stringify({ errors: [{ description: `rota desconhecida ${method} ${path}` }] }), { status: 404 });
  }
}
