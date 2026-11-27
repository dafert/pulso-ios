# Pulso

Editor e cliente para criar e enviar figurinhas animadas com som sincronizado (WebP + Ogg/Opus) no WhatsApp.

- **Site:** https://pulso-extrefad.pages.dev
- **App Web:** https://pulso-extrefad.pages.dev/app/
- **Downloads:** [Releases](https://github.com/dafert/pulso-ios/releases/latest) (`Pulso-Android.apk` e `Pulso-iOS.ipa`)

## Como usar

### Navegador (Web)
Abra o [App Web](https://pulso-extrefad.pages.dev/app/), conecte seu WhatsApp Web por código de 8 dígitos ou QR Code (via Cloudflare Browser Rendering) e envie figurinhas animadas em 512 × 512 com áudio sincronizado. No PC (Chrome/Edge/Brave), você também pode instalar `Pulso-Extensao-Chrome.zip` para enviar direto para uma aba já aberta do WhatsApp Web.

### Android (`.apk`)
1. Baixe `Pulso-Android.apk` na página de [Releases](https://github.com/dafert/pulso-ios/releases/latest).
2. Abra o arquivo no celular e autorize a instalação a partir do navegador/gerenciador de arquivos.
3. No app, abra a aba **Conectar WhatsApp**, informe seu número (DDD + telefone) para gerar o código de 8 dígitos e vincule em **WhatsApp → Dispositivos conectados → Conectar com número de telefone**.
4. Volte para a aba **Editor**, escolha o vídeo e toque em **Criar automático**.

### iPhone (`.ipa`)

O arquivo `Pulso-iOS.ipa` pode ser instalado por computador ou diretamente pelo aparelho:

**Pelo computador (Windows ou Mac) com Sideloadly**
1. Baixe `Pulso-iOS.ipa` na página de [Releases](https://github.com/dafert/pulso-ios/releases/latest) e instale o [Sideloadly](https://sideloadly.io).
2. Conecte o iPhone ao computador via cabo USB e toque em **Confiar** no aparelho.
3. Arraste `Pulso-iOS.ipa` para a janela do Sideloadly, informe seu Apple ID e clique em **Start**.
4. No iPhone, abra **Ajustes → Geral → Gestão de VPN e Dispositivo** e toque em **Confiar** no certificado do seu Apple ID.
5. Caso o iOS solicite, ative **Ajustes → Privacidade e Segurança → Modo de Desenvolvedor**.
6. Abra o Pulso, conecte seu WhatsApp pelo número na aba **Conectar** e envie suas figurinhas.

**Direto no iPhone com SideStore / AltStore**
1. Adicione a fonte `https://pulso-extrefad.pages.dev/source.json` no SideStore ou AltStore.
2. Instale o Pulso pela lista de apps e conecte seu WhatsApp pelo número dentro do app.

## Estrutura do repositório

- `docs/` — Site público e Web App (Cloudflare Pages + `libwebp` WebAssembly).
- `worker/` — Cloudflare Worker zero-dependência (`Browser Rendering` CDP) que conecta o Web App ao WhatsApp Web.
- `extension/` — Extensão Chrome/Edge MV3 que conecta o Editor Web diretamente à aba aberta do WhatsApp Web.
- `android/` — Projeto Android (Kotlin + `WebViewAssetLoader` + bridge de envio).
- `Pulso/` e `project.yml` — Projeto iOS (Swift + `WKWebView` + `AVAudioConverter` Opus + XcodeGen).
- `server/` — Ponte Node.js opcional (Express + Playwright + ffmpeg) para auto-hospedagem.
- `.github/workflows/` — Pipelines de compilação do `.apk` e `.ipa`.

## Compilação local

```sh
# Android
cd android && gradle assembleRelease

# iOS (macOS com Xcode + XcodeGen)
xcodegen generate
xcodebuild -project Pulso.xcodeproj -scheme Pulso -configuration Release -sdk iphoneos

# Servidor Web opcional
cd server && npm install && npm start
```

## Apoio

Mantido por **extrefad**. Contribuições voluntárias:

- **USDC (Rede Solana):** `D8UNtn8VyMRjFGZcQiXM8EWnhuNcfbqz4Bv6ZV8CnCpA` *(apenas USDC nativo na rede Solana)*
- **BTC (Rede Bitcoin):** `39XSR2S184prA1CAKAJnn35qP4actcU1FB` *(apenas BTC na rede Bitcoin)*
- **ETH (Rede Ethereum):** `0x5B557AD0A8ee7FA9779080931f228c07439a4C08` *(apenas ETH na rede Ethereum — não enviar ERC-20, WETH ou NFTs)*

## Licença

Distribuído sob [PolyForm Noncommercial License 1.0.0](LICENSE.md).

`Required Notice: Copyright Shirtep (https://github.com/Shirtep/WA-audio-stickers)`

Bibliotecas de terceiros listadas em [THIRD_PARTY.md](THIRD_PARTY.md).
