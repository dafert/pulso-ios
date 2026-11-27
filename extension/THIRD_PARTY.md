# Componentes de terceiros

A base do projeto é WA-audio-stickers (Shirtep). O [Required Notice e a licença PolyForm Noncommercial 1.0.0](LICENSE.md) acompanham o código e o pacote de instalação.

## Componentes incluídos na extensão

| Componente | Versão fixa | Licença | Arquivos |
| --- | --- | --- | --- |
| [libwebp](https://github.com/webmproject/libwebp/tree/v1.6.0) | v1.6.0, commit `4fa21912338357f89e4fd51cf2368325b59e9bd9` | BSD de três cláusulas, com [concessão adicional de patentes](vendor/libwebp/PATENTS) | `vendor/libwebp/encoder.wasm`, [COPYING](vendor/libwebp/COPYING) |
| [Emscripten](https://github.com/emscripten-core/emscripten/tree/5.0.2) | 5.0.2 | [MIT, University of Illinois/NCSA e avisos dos componentes incluídos](vendor/libwebp/EMSCRIPTEN-LICENSE) | `vendor/libwebp/encoder.js` e suporte de execução no WASM |
| [MP4Box.js](https://github.com/gpac/mp4box.js/tree/v2.3.0) | 2.3.0 | [BSD-3-Clause](vendor/mp4box/LICENSE) | `vendor/mp4box/mp4box.all.js`, extraído do pacote npm |

O adaptador C em `scripts/encoder.c` usa WebPAnimEncoder do libwebp. O JavaScript gerado foi compilado sem avaliação dinâmica de código, sem threads, sem SIMD obrigatório e para o ambiente Worker. As licenças dos componentes acompanham o pacote compilado dentro de `vendor/`.

Ferramentas de desenvolvimento usadas fora do navegador têm versão fixa em `package.json` e `package-lock.json`: esbuild (MIT), TypeScript (Apache-2.0), ESLint e typescript-eslint (MIT), globals (MIT), tipos DOM WebCodecs (MIT), Vitest (MIT) e Playwright (Apache-2.0). As dependências das ferramentas, a instalação do Chromium de teste e os geradores de amostras não integram a extensão.
