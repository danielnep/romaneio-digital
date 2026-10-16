# OCR e tela de diagnóstico

O botão **Logs OCR** no cabeçalho abre o histórico em qualquer tela. Durante uma leitura, **Ver logs em tempo real** mantém o reconhecimento em andamento e mostra o progresso. **Voltar à operação** retorna à tela anterior.

O histórico mostra arquivo e dimensões, avaliação de luz, carregamento do motor/idioma, reutilização do worker, parâmetros de cada tentativa, recorte, status do reconhecimento, confiança, candidatos, preenchimento, conflitos e erros. O texto reconhecido e os valores dos campos sensíveis são mascarados antes de gravar, exibir, copiar ou exportar logs. Os detalhes podem ser expandidos. Há filtros, cópia, exportação JSON e limpeza. Logs antigos armazenados neste aparelho também são mascarados na inicialização. Até 300 eventos ficam neste aparelho; as imagens não são persistidas no histórico nem enviadas pelo OCR a uma API de reconhecimento.

## Fotos durante o dia

A primeira tentativa usa a imagem original, com limite de resolução. Só quando necessário são tentados um recorte da área reconhecida, cinza com contraste leve e cores preservadas. Não há aumento de brilho para compensar fotos noturnas. A medição de pixels claros/escuros é um diagnóstico de luminância, não uma detecção garantida de reflexos. Uma placa pequena, desfocada ou coberta por reflexo ainda pode exigir outra foto ou revisão manual.

O Tesseract.js está fixado em 5.1.1. O worker é reutilizado; a whitelist é limpa antes de documentos. Há limite de tempo e cancelamento, e resultados de uma leitura cancelada não preenchem outra entrada.

## Correções

- Correspondências exatas de placas antigas e Mercosul são preservadas. Correções sugeridas e resultados ambíguos exigem confirmação.
- Nome, RG e CNH precisam de seus rótulos. CPF não é usado como CNH, e filiação não é escolhida como motorista. A confiança das palavras encontradas é considerada quando disponível.
- Valores existentes são preservados quando uma leitura diverge; o operador pode confirmar o candidato da placa ou revisar o formulário.
- A triagem permite chegar aos campos da etapa seguinte. Dados obrigatórios são validados na revisão, inclusive a placa do cavalo quando exigida.
- O pop-up de vistoria deixa de ser fechado pelo fim da leitura. O uso manual é registrado no histórico local e no modo do registro enviado.
- A opção “Não foram encontrados materiais na vistoria” pode ser marcada pelo texto inteiro. Ela dispensa digitação, registra “Nenhum material encontrado” e bloqueia edição do campo enquanto marcada. Desmarcar restaura a descrição anterior; um novo atendimento limpa a seleção. A revisão exige descrição ou esta confirmação.
- A lista de saídas e sua conferência mostram porte, placas, portaria e vigia da entrada. Novas entradas guardam o responsável junto ao veículo. Registros antigos sem esse dado mostram “Não registrado”; o vigia da saída não é atribuído à entrada. Os campos adicionais são preservados no envio, mas seu armazenamento na planilha depende do backend.
- `.nojekyll` permite publicar este aplicativo estático sem processá-lo como um site Jekyll.

## Testes reproduzíveis

`npm test` executa os testes puros de extração e validação. Para o navegador: `npm install`, `npx playwright install chromium` e `npm run test:browser`. O aplicativo não precisa de build npm para ser hospedado.

O teste de navegador usa Tesseract.js real, modelo português real e imagens sintéticas com resultado conhecido em `tests/fixtures`. Testa reconhecimento, troca placa/documento, seleção de baú/cavalo, navegação, vistoria, exportação/cópia, filtros, persistência, imagem inválida e recuperação. A inicialização pendente é simulada somente nos testes específicos de timeout/cancelamento. O transporte dos arquivos públicos do CDN é feito pelo Node para contornar restrições do navegador de teste; os resultados OCR não são simulados. Requisições ao backend operacional são interceptadas para não criar registros reais.

As imagens atuais da raiz do repositório são logos. Portanto, a validação automatizada não mede a precisão nas fotos reais feitas na portaria, nem comprova uma gravação no backend real. Fotos reais podem ser analisadas a partir dos próximos logs exportados.

Referência: https://github.com/naptha/tesseract.js/blob/v5.1.1/docs/api.md
