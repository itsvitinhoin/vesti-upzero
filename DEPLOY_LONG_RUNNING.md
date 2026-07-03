# Deploy para migrações longas

Este projeto pode rodar na Vercel para uso leve, mas migrações de catálogo com imagens podem durar horas. Para esse cenário, use um servidor Node persistente via Docker.

## Recomendado

- VPS, Render, Railway, Fly.io ou qualquer host que rode Docker continuamente.
- Pelo menos 2 GB de RAM.
- Evite desligar/reiniciar o container durante uma migração.
- Configure timeout alto no proxy/load balancer.

## Rodar com Docker Compose

```bash
docker compose up -d --build
```

Depois acesse:

```text
http://SEU_SERVIDOR:3000
```

Health check:

```text
http://SEU_SERVIDOR:3000/api/health
```

## Segurança das chaves

Não coloque chaves reais no `.env` do servidor para uso multi-cliente.

O fluxo recomendado continua sendo:

1. O usuário abre a interface.
2. Preenche as chaves temporárias do cliente.
3. Roda a migração.
4. As chaves ficam apenas na requisição atual.

## Nginx opcional

Se usar Nginx na frente do container, aumente os timeouts para permitir streams longos:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 6h;
  proxy_send_timeout 6h;
  proxy_connect_timeout 60s;
  proxy_buffering off;
}
```

As rotas de sincronização enviam heartbeat SSE a cada 15 segundos para reduzir queda por conexão ociosa.

## Comandos úteis

Ver logs:

```bash
docker compose logs -f vesti-upzero
```

Reiniciar:

```bash
docker compose restart vesti-upzero
```

Atualizar nova versão:

```bash
docker compose up -d --build
```
