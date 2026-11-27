# Pulso

Extensão não oficial para criar figurinhas de 512 × 512 px, com ou sem áudio, a partir de vídeos, GIFs e imagens. Baseado em WA-audio-stickers (Shirtep), sob a licença PolyForm Noncommercial 1.0.0. Veja [LICENSE.md](LICENSE.md) e [THIRD_PARTY.md](THIRD_PARTY.md).

## Instalar no Chrome, Edge ou Brave

1. Extraia o pacote de instalação em uma pasta que você possa manter.
2. Acesse `chrome://extensions`, `edge://extensions` ou `brave://extensions` e ative o **Modo do desenvolvedor**.
3. Selecione **Carregar sem compactação** e escolha a pasta com o `manifest.json` compilado. Se estiver usando o repositório, escolha `dist/`.
4. Abra ou recarregue o WhatsApp Web. Clique em **Pulso** no canto inferior direito para abrir ou recolher o painel. O ícone da extensão também alterna o painel na própria página.

A extensão requer Chromium 120 ou posterior. Decodificadores de vídeo dependem do navegador, do sistema e dos codecs instalados.

## Usar

- **Arquivo**. Selecione, solte ou cole com **Ctrl+V**. A fila aceita até 15 vídeos, imagens ou GIFs, com até 64 MiB por arquivo e 960 MiB no total.
- **Enquadrar**. Use **Cortar** para preencher o quadro, **Ajustar** para preservar a proporção com transparência ou **Esticar** para preencher deformando a imagem. O recorte sugere um foco com base no movimento e no detalhe. Para refiná-lo, use zoom e arraste a prévia, ou coloque-a em foco e use as setas. **Desfazer corte de bordas** recupera as margens removidas. As barras são detectadas por amostras, então vale conferir quadros com conteúdo escuro.
- **Áudio**. O player deixa ouvir o áudio original antes de preparar a figurinha; depois, mostra o Ogg/Opus processado que será enviado. Use o som do vídeo ou anexe uma faixa a uma imagem, GIF ou vídeo. Ajuste o início e o fim na linha do tempo. O tratamento aplica passa-altas de 80 Hz, fades curtos e limitador de pico. A normalização busca aproximadamente −16 LUFS. A opção de voz realça a presença e usa mono. Se o navegador encerrar o Worker de áudio, a extensão refaz a codificação em mono diretamente no editor. Se o áudio original estiver ausente ou falhar, escolha um arquivo separado ou **Sem som**.
- **Qualidade**. Escolha **Máxima qualidade**, **Equilibrado** ou **Leve**. O arquivo sempre tem 512 × 512 px. A resolução de detalhe pode cair para caber em 1 MB. A prévia mede SSIM e PSNR em amostras do WebP decodificado, e o indicador de tamanho usa os bytes efetivos.
- **Enviar fila**. O botão fica acessível acima do editor mesmo quando você muda de etapa. Um clique prepara e salva os itens pendentes na sua própria conversa. Use **Parar fila** para interromper depois do item em andamento. Os itens já confirmados ficam marcados. Uma falha de edição ou envio aparece junto ao arquivo afetado.
- **Enviar**. Confira a figurinha e escolha **Enviar pelo WhatsApp**. A opção padrão salva na sua própria conversa e abre o diálogo nativo de encaminhamento, onde você escolhe os destinatários. O painel se recolhe quando o diálogo nativo de encaminhamento abre. Você pode reabri-lo no canto para retomar o trabalho ou baixar o WebP e, se houver áudio, o Ogg.
- **✨ Automático**. Use **Ctrl+Enter** ou o botão para detectar margens, enquadrar, normalizar a faixa selecionada e preparar a figurinha com a predefinição atual. Equilibrado é o padrão mais rápido. Máxima qualidade examina mais opções e leva mais tempo. **Esc** cancela a preparação. O envio exige uma ação separada.

Para o envio, o WebP usa uma margem conservadora de 100 kB quando estático e 500 kB quando animado, inspirada nos [limites publicados para figurinhas do WhatsApp](https://github.com/WhatsApp/stickers/blob/main/Android/README.md). O áudio pré-escutado é preservado se o WebP precisar ser recomprimido. O painel aguarda a confirmação do WhatsApp antes de marcar um item como enviado.

Os trechos visuais e de áudio aceitam até 12 segundos. O arquivo usado para extrair áudio pode ter até dois minutos, e o vídeo ou imagem aceita até 17 megapixels e 8192 px por lado. A escala exibida no simulador de conversa varia no aplicativo real.

## Privacidade e compatibilidade

O painel fica no canto do WhatsApp Web. Os arquivos são processados localmente em um quadro isolado da extensão, dentro da página. Um Worker usa OffscreenCanvas, WebCodecs, MP4Box ou o parser WebM local, e libwebp compilada para WASM. Se o WASM falhar, o Worker codifica WebP via Canvas. Se a decodificação direta de vídeo falhar, a aba tenta o decodificador nativo de vídeo e entrega os quadros ao Worker. A CSP da extensão permite carregar apenas recursos empacotados, inclusive WASM. O script na página do WhatsApp usa seus módulos internos para o envio solicitado. Só a extensão recebe o arquivo original. Ao enviar, o WhatsApp Web recebe o WebP e o Ogg preparados e usa sua conexão habitual para salvar a mensagem.

O único armazenamento da extensão guarda preferências. Recolher o painel preserva a fila, as prévias e os arquivos enquanto o WhatsApp Web ficar aberto. Recarregar ou fechar a aba limpa esse trabalho. As preferências ficam no armazenamento da extensão. As permissões são `storage` e acesso a `https://web.whatsapp.com/*`. O autoteste da aba informa **Compatível**, **Parcial** ou **Incompatível** de acordo com os módulos visíveis. O estado **Compatível** confirma a descoberta dos módulos. O envio ainda depende da sessão, do navegador e do servidor. Caso reste uma mensagem salva na sua conversa, use essa mensagem para encaminhar.

A detecção voz/música usa características estéreo como heurística. O pico mostrado é uma estimativa true peak de quatro fases medida após decodificar o Ogg final. O encoder reduz o ganho se a medição ultrapassar −1 dBTP. Normalização sujeita a limitação, clipes muito curtos e silêncio podem ficar abaixo da meta. O HEVC funciona quando o navegador puder decodificar. Arquivos MOV, MP4 e WebM fora dos formatos contemplados pelo caminho direto podem usar o decodificador alternativo.

## Desenvolver e testar

Requer Node.js 22.12+ e npm. O ZIP de código-fonte inclui `pulso.bundle` com o histórico. Para abrir esse histórico em um repositório, use `git clone pulso.bundle pulso-repositorio`. As dependências npm servem para desenvolvimento. A extensão compilada funciona a partir dos arquivos locais.

```sh
npm ci
npx playwright install chromium
npm run check
```

`npm run build` recria `dist/`. O encoder pré-compilado fica em `vendor/libwebp/`. Para recompilá-lo, aponte o script para o código-fonte de libwebp no commit indicado em [THIRD_PARTY.md](THIRD_PARTY.md), usando o Emscripten 5.0.2 ativado.

```sh
node scripts/build-wasm.mjs /caminho/para/libwebp
```

No Windows, defina `PULSO_EMCC_PY` com o caminho do `emcc.py` do SDK ativo antes de chamar o script. Use `node scripts/render-icons.mjs` para derivar os PNGs do SVG.

Vitest cobre enquadramento, qualidade, loudness, WebP e Ogg. Playwright carrega a extensão no Chromium com módulos falsos do WhatsApp Web, CSP estrita e arquivos de teste gerados localmente. Os testes verificam abertura no canto, fechamento, reabertura e envio pela mesma aba. As amostras cobrem imagem com transparência, GIF em movimento, WebM, MP4 de cadência variável, MOV com rotação e áudio estéreo. A suíte simula upload, criação da mensagem, encaminhamento e restauração. WhatsApp real, reprodução de figurinhas em aparelhos e os navegadores Edge e Brave ficam fora desse teste automatizado.
