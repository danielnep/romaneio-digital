# Horizon UI Guardian | Correções de UI/UX e operação | 16/10/2026

Escopo: branch isolada para revisão, sem publicação automática e sem mudanças no Google Apps Script.

## Correções implementadas

1. **Frota própria:** finalização do monitoramento GPS ao terminar a ação, inclusive em erro de gravação local; o texto evita afirmar abertura física do portão.
2. **Envios:** gravação em IndexedDB antes de transmitir, fila offline e sincronização HTTP JSON com resposta de persistência do banco SQLite do servidor. Cada registro usa ID idempotente; até receber ACK permanece pendente para reenvio seguro.
3. **Modo de desenvolvimento:** controle e rotina de auto-preenchimento removidos da interface operacional.
4. **Rascunho:** dados do atendimento atual armazenados localmente, com expiração em 24 horas, botão de retomada, recuperação de etapa e nova aquisição de GPS. Selfie deve ser refeita ao retomar.
5. **Saída manual:** validação de placa; procura local por placa do baú ou do cavalo na portaria; vincula uma entrada única antes de liberar; bloqueia múltiplas entradas ambíguas; exige confirmação explícita quando não houver entrada neste aparelho.
6. **Responsável:** identificação visível e editável de vigia, persistida neste aparelho, em lugar da atribuição invariável a Daniel.
7. **Privacidade OCR:** campos e textos pessoais mascarados antes de persistir e exportar logs. Histórico legado é tratado na inicialização.
8. **Modal de vistoria:** ação de voltar sem confirmar; na saída, o cancelamento encerra o GPS e retorna à lista.
9. **UI móvel:** texto legível, dicas de validação junto às etapas, controles maiores, hierarquia simplificada, tema claro institucional Horizon, indicadores reais de GPS, redução de cards na entrada, acessibilidade de foco e animação reduzida.
10. **Selfie carimbada:** qualquer edição posterior dos dados relevantes invalida a selfie anterior e exige nova captura.

## Limitações e observações obrigatórias

- O projeto agora inclui `server.js`: banco SQLite, API REST autenticada e confirmação por `operationId`. O serviço precisa estar implantado num servidor com armazenamento persistente para sincronização real. **O repositório não tinha um servidor Romaneio Digital publicado** e nenhuma configuração de produção foi criada nesta branch.
- Registros sem ACK continuam completos na fila local para reenvio idempotente; só são removidos após resposta do banco. Itens legados `sent_unverified` da proposta anterior são mantidos para conferência manual, pois seus dados já não estavam disponíveis para retransmissão. O navegador pode apagar dados locais, logo a sincronização depende de servidor em funcionamento e chave válida.
- A retomada de rascunho usa armazenamento local do navegador; em aparelhos compartilhados, exige controle de acesso ao dispositivo e política de limpeza. A selfie não é restaurada.
- A rotina de auto-preenchimento DEV foi retirada do código de produção; os testes usam seus próprios dados controlados.
- O nome de vigia fica editável no painel. Ainda não há autenticação individual nem verificação independente de identidade.
- A identidade Horizon foi aplicada em estilo; não foi reproduzida nenhuma matriz de logomarca não disponível no repositório.
- Nenhum serviço foi implantado, nenhum backend foi alterado e nenhum teste físico foi executado nesta mudança.

## Verificação de regressão

- `npm test`: testes de OCR e regressão do Guardian (rascunhos, correspondência de saída manual, autorização de saída órfã e mascaramento de logs).
- `npm run test:browser`: testes existentes Playwright; os testes que antes esperavam PII nos logs foram adaptados à nova política de proteção.

### Roteiro para teste manual antes de mesclar

1. Entrada normal (P1/P2/P3), capturar OCR, conferir dados, vistoria, selfie e envio com internet.
2. Iniciar entrada, preencher a primeira etapa, recarregar e usar **Retomar atendimento**. Confirmar revalidação de GPS e necessidade de nova selfie.
3. Ficar offline, salvar uma entrada, religar a conexão e conferir contagem de envios pendentes e enviados sem confirmação.
4. Registrar saída de entrada existente, associar manualmente pela placa do cavalo e verificar se o veículo correto some do pátio.
5. Tentar saída manual de placa desconhecida sem marcar autorização: botão deve permanecer desativado. Confirmar com a opção explícita; então liberar.
6. Tentar saída com duas entradas locais de mesma placa: deve bloquear liberação e orientar seleção pela lista.
7. Iniciar liberação de frota própria e conferir que monitoramento GPS para após finalizar.
8. Conferir logs OCR exportados sem texto dos documentos ou números sensíveis.
9. Alterar campo do formulário após bater selfie e conferir que **Salvar entrada** exige nova selfie.
10. Simular falhas de GPS, armazenamento e internet em aparelho real antes de produção.

## Status de validação

A sintaxe de `js/app.js` e `js/ocr-logs.js` foi verificada; cenários de rascunho, associação manual, saída órfã e mascaramento foram executados com ambiente DOM simulado. A suíte `npm test`, Playwright com navegador real, gravação no backend e ensaios em celular ainda dependem de execução no ambiente apropriado.

## Infraestrutura de servidor

- Rodar com Node.js 22.13+ e `npm start`.
- Em Railway, criar **serviço separado Romaneio Digital**, com fonte GitHub `danielnep/romaneio-digital` e **volume persistente montado em `/data`**; nunca misturar dados com Rondas Pro.
- Variáveis obrigatórias no Railway: `ROMANEIO_DB_PATH=/data/romaneio.sqlite`, `ROMANEIO_SYNC_TOKEN=<segredo de no mínimo 24 caracteres>`. `ROMANEIO_ALLOWED_ORIGINS=https://danielnep.github.io` libera o GitHub Pages, se utilizado.
- No painel do app, configurar o endereço HTTPS do serviço e a chave (em armazenamento somente da sessão). A origem atual é usada por padrão quando o próprio servidor hospeda a interface.
- A API é `POST /api/records` (gravação), `GET /api/records/:operationId` (verificação), `GET /api/status` (estado com autenticação) e `GET /health` (saúde).
- Se faltar volume configurado no Railway, o servidor **não inicia**, impedindo dados numa pasta efêmera.
- Não há serviço Romaneio em funcionamento identificado na Railway neste momento. Portanto, até configurar implantação + token, registros continuam locais e a sincronização não ocorrerá.

