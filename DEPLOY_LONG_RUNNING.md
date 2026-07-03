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

## Cloud Run Jobs (alternativa sem servidor sempre ligado)

Se preferir publicar no Cloud Run em vez de manter um servidor Docker sempre de pé, cada disparo pelo painel pode criar uma execução de **Cloud Run Job**, que roda até terminar sem o limite de timeout de requisição (60 min) de um Cloud Run Service comum. O progresso fica em Firestore e o painel acompanha por polling em vez de manter o stream SSE aberto.

1. Habilite o Firestore (modo Nativo) no projeto GCP.
2. Publique o painel como Cloud Run **Service**, usando a mesma imagem deste `Dockerfile`:

   ```bash
   gcloud run deploy vesti-upzero \
     --image <sua-imagem> --region <region> \
     --service-account <sa-do-service> \
     --set-env-vars GOOGLE_CLOUD_PROJECT=<projeto>,CLOUD_RUN_JOB_REGION=<region>,CLOUD_RUN_CATALOG_JOB_NAME=catalog-sync-job,CLOUD_RUN_COLOR_TERMS_JOB_NAME=color-terms-sync-job,NEXT_PUBLIC_USE_CLOUD_RUN_JOBS=true
   ```

3. Publique os dois **Jobs**, reaproveitando a mesma imagem (o comando é sobrescrito, sem rebuild):

   ```bash
   gcloud run jobs deploy catalog-sync-job \
     --image <mesma-imagem> --region <region> \
     --command node_modules/.bin/tsx --args=scripts/jobs/run-sync-job.ts \
     --set-env-vars JOB_KIND=catalog,GOOGLE_CLOUD_PROJECT=<projeto>,NODE_OPTIONS=--conditions=react-server \
     --service-account <sa-do-job> --task-timeout 6h --memory 2Gi --max-retries 0

   gcloud run jobs deploy color-terms-sync-job \
     --image <mesma-imagem> --region <region> \
     --command node_modules/.bin/tsx --args=scripts/jobs/run-sync-job.ts \
     --set-env-vars JOB_KIND=color-terms,GOOGLE_CLOUD_PROJECT=<projeto>,NODE_OPTIONS=--conditions=react-server \
     --service-account <sa-do-job> --task-timeout 6h --memory 2Gi --max-retries 0
   ```

   `NODE_OPTIONS=--conditions=react-server` é necessário porque o pacote `server-only` (usado em `lib/server-api-config.ts` para impedir que credenciais vazem para o bundle do navegador) só resolve para uma implementação vazia sob essa condição de export — é o mesmo mecanismo que o bundler do Next aplica automaticamente para as rotas da API, mas que precisa ser passado explicitamente ao rodar `scripts/jobs/run-sync-job.ts` fora do Next.

4. IAM: a service account do Service precisa de `roles/run.developer` (ou papel com `run.jobs.run`) sobre os dois Jobs, mais `roles/datastore.user` (Firestore). A service account dos Jobs precisa só de `roles/datastore.user`.

As chaves da Vesti/UP Zero digitadas no painel continuam trafegando só na execução (variável de ambiente efêmera do Job) — nunca são gravadas no Firestore nem no `.env` do servidor.

Sem essas variáveis configuradas (`NEXT_PUBLIC_USE_CLOUD_RUN_JOBS=false`, o padrão), o painel continua chamando `/api/sync/catalog` e `/api/sync/color-terms` diretamente com SSE, exatamente como no modo Docker/VPS acima.

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
