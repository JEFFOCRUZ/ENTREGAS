# Bobinou Entregas — versão por cidade

Painel web para entregadores da Bobinou integrado à Nuvemshop.

## Acesso por cidade

- **Ponta Grossa:** PIN padrão `8803`.
- **Guarapuava:** PIN configurável pelo `.env` (padrão de desenvolvimento `1234`).

Após o login, o servidor filtra os pedidos pelo campo de cidade do endereço de entrega. Um entregador autenticado em Ponta Grossa não recebe na API os pedidos de Guarapuava e também não pode atualizar manualmente um pedido de outra cidade.

## Recursos

- Pedidos abertos da Nuvemshop.
- Filtro seguro por cidade no servidor.
- Cliente, telefone, endereço, valor, pagamento e itens.
- Google Maps e WhatsApp.
- Aguardando / Saiu para entrega / Entregue / Problema.
- Observação do entregador.
- Opcional: fulfillment na Nuvemshop ao marcar como entregue.

## Instalação

1. Instale Node.js 18+.
2. Copie `.env.example` para `.env`.
3. Informe `NUVEMSHOP_STORE_ID` e um **novo** `NUVEMSHOP_ACCESS_TOKEN`.
4. Execute:

```bash
npm install
npm start
```

5. Abra `http://localhost:3000`.

## Segurança

O token da Nuvemshop fica somente no servidor. Não coloque o `.env` no GitHub ou em JavaScript do navegador.

Antes de produção, use HTTPS e altere `secure: false` para `secure: true` no cookie da sessão.
