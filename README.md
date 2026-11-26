# Pulso para iOS (iPhone 11) — Build grátis via GitHub Actions

Este projeto empacota o **Pulso 0.9.7** dentro de um app iOS (`WKWebView` abrindo o WhatsApp Web em modo computador) com:
- **Áudio Ogg/Opus nativo do iOS** (`AVAudioConverter` com `kAudioFormatOpus`)
- **WebP animado via `encoder.wasm`** (`libwebp` WebAssembly embutido no app, funcionando no WebKit do iOS)
- **Acesso à galeria de vídeos/fotos do iPhone** direto pelo botão **⚡ Pulso**
- **Compilação automática de `.ipa` sem Mac e sem licença paga Apple Developer** usando GitHub Actions (`macos-latest`).

## Como gerar seu `Pulso-iOS.ipa` (5 minutos)

1. Crie uma conta gratuita no [GitHub](https://github.com) (se ainda não tiver) e crie um repositório novo (pode ser **público** ou **privado**, ex.: `pulso-ios`).
2. Na página do repositório vazio, clique em **uploading an existing file** e arraste **todos os arquivos e pastas** de dentro desta pasta (`project.yml`, pasta `Pulso/`, e a pasta `.github/`).
   - **Dica:** se arrastar no navegador não incluir a pasta `.github`, clique em **Add file → Create new file**, digite `.github/workflows/build-ipa.yml` e cole o conteúdo de `.github/workflows/build-ipa.yml`.
3. Clique em **Commit changes**.
4. Vá na aba **Actions** do seu repositório → clique no workflow **Compilar Pulso iOS (.ipa)** (se não iniciar sozinho, clique em **Run workflow**).
5. Espere ~2 minutos até ficar verde (✓) e baixe o arquivo **`Pulso-iOS-ipa`** na seção **Artifacts** no rodapé da execução. Extraia o `.zip` para obter o **`Pulso-iOS.ipa`**.

## Como instalar o `Pulso-iOS.ipa` no iPhone 11 (de graça, sem licença paga)

1. No Windows, baixe o **Sideloadly** (https://sideloadly.io) ou **AltStore** (https://altstore.io).
2. Conecte o iPhone 11 no cabo USB e toque em **Confiar** no celular.
3. Arraste o **`Pulso-iOS.ipa`** para o Sideloadly, coloque seu Apple ID comum (gratuito) e clique em **Start**.
4. No iPhone 11: vá em **Ajustes → Geral → Gestão de VPN e Dispositivo** e toque em **Confiar** no seu Apple ID.
5. Se estiver no iOS 16+, ative **Ajustes → Privacidade e Segurança → Modo de Desenvolvedor**.
6. Abra o **Pulso**, conecte o WhatsApp Web (por QR Code ou código por número de telefone) e toque no botão **⚡ Pulso** no canto inferior direito!
