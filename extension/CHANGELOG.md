## 0.9.7 — Sincronia áudio/vídeo e envio estável em fila no WhatsApp Web

- Dimensões reais (`side × side`) e duração inteira do áudio enviadas ao `MediaPrep` do WhatsApp Web, evitando travamento de upload (spinner infinito).
- Flags de figurinha com som mantidos ativos durante a fila (`restore` adiado por 20 s) sem abortar uploads em andamento no `finally`.
- A fila não para mais inteira se um item falhar e aplica pausa de 1,5 s entre envios para não engasgar o WhatsApp Web.
- Sincronia exata de quadros WebP com a duração do áudio (captura no meio do intervalo `(i + 0.5) / fps`, compensação de offset inicial do vídeo e grade exata `totalMs` igual à extensão original).

## 0.9.6 — Processamento local sem Worker e busca WebP otimizada

- Quando o navegador encerra ou bloqueia o Worker de vídeo/imagem, a análise e a codificação WebP passam a rodar diretamente no editor (sem criar outro Worker).
- Redução do orçamento de memória de quadros (48 MB / 576 px) para evitar encerramento por falta de memória.
- Escada de resolução/FPS otimizada na busca WebP para evitar timeouts e melhorar nitidez em vídeos longos de até 12 segundos.
- `media-worker.js` e `encoder.wasm` adicionados em `web_accessible_resources` para o WhatsApp Web.
- Corrigida a segunda passada de áudio sem Worker e o teto do limitador (`ceiling`) para evitar falso erro de pico em áudios muito altos.
- Conversão ultrarrápida em 1 passada (estimativa por amostra + WebP nativo no tamanho real do quadro + áudio Opus em blocos), reduzindo o tempo de ~60 s para poucos segundos por vídeo.

## 0.9.5 — correção de recuperação de vídeos

- Recuperação automática quando o Worker de vídeo falha: tenta decodificar pelo navegador e reinicia o Worker uma única vez.
- Análise visual inicial limitada a nove quadros no modo compatível, reduzindo uso de memória.
- Mensagem mais informativa se também falhar o processamento alternativo.

# Histórico de alterações

## 0.9.5 — Recuperação direta do áudio

- Se o navegador encerrar o Worker de áudio, refaz a codificação em mono no editor, sem iniciar outro Worker.
- Confere o áudio recuperado localmente e mostra a versão no cabeçalho do editor.

## 0.9.3 — Recuperação do áudio

- Se o navegador encerrar a codificação de áudio, tenta novamente em mono com carga reduzida e informa o modo usado.
- Dá limite de um minuto à codificação e mostra melhor o motivo quando um Worker falha.

## 0.9.2 — Prévia ampliada e fila acessível

- Aumenta o painel e a prévia no WhatsApp Web, com layout em coluna quando a tela é estreita.
- Deixa o player do áudio original disponível antes da conversão e mantém o vídeo audível na prévia.
- Mantém o envio da fila visível durante a edição e mostra o erro específico em cada arquivo.
- Exibe a etapa, o nome do arquivo e o motivo quando a edição falha.
- Preserva melhor o início e o fim da fala ao remover silêncio e reduz a quantidade de quadros no decodificador alternativo.

## 0.9.1 — Painel no WhatsApp Web

- O editor fica no canto inferior direito do WhatsApp Web. O botão na página e o ícone da extensão abrem e recolhem o painel.
- Recolher o editor mantém a fila e a figurinha preparada. O painel se recolhe quando o diálogo nativo Encaminhar aparece.
- A conversão e os arquivos originais ficam isolados no quadro da extensão. O envio segue pela mesma aba do WhatsApp Web.
- A fila aceita até 15 itens e pode salvá-los na própria conversa com um clique, aguardando a confirmação de cada mensagem.
- Equilibrado reduz as passadas de codificação. O Opus mantém um fluxo contínuo, com conferência da duração do áudio final.

## 0.9.0 — Pulso

- Novo editor em aba própria, com prévia de enquadramento, simulador de conversa, tema do sistema, teclado e fila local.
- Modo Automático, remoção de bordas por amostragem, foco sugerido, zoom, três predefinições e medição amostral de qualidade.
- Codificação WebP de 512 × 512 px em Worker, com libwebp, subquadros diferenciais, busca de qualidade e fallback via Canvas.
- Tratamento local de áudio, recorte opcional de silêncio, Opus adaptativo, pré-escuta e exportação.
- Compatibilidade com os módulos da página por autoteste e fallback de nomes. Envio um a um para a própria conversa, com a opção padrão de abrir Encaminhar.
- Build esbuild, verificação estrita de tipos do núcleo, ESLint e suítes Vitest e Playwright.

## 0.8.0

- Base traduzida para português do Brasil de WA-audio-stickers (Shirtep).
