import UIKit
import WebKit

final class WhatsAppViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var topBar: UIView!
    private var tabControl: UISegmentedControl!
    private var reloadButton: UIButton!

    private var waContainer: UIView!
    private var waWebView: WKWebView!
    private var waHelperBar: UIView!
    private var waHelperTitle: UILabel!
    private var waHelperSubtitle: UILabel!
    private var waHelperButton: UIButton!

    private var editorContainer: UIView!
    private var editorWebView: WKWebView!

    private var pendingRequests: [String: (String) -> Void] = [:]
    private var isWhatsAppLoggedIn = false
    private var detectedPairingCode: String?
    private var backgroundTaskID: UIBackgroundTaskIdentifier = .invalid
    private var pendingClickPhoneLogin = false

    private let desktopUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15"

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.10, green: 0.08, blue: 0.14, alpha: 1)
        setupTopBar()
        setupWhatsAppContainer()
        setupEditorContainer()
        registerLifecycleObservers()
        showTab(0) // Abre direto no Editor Pulso (sem exigir login)
        loadWhatsApp()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        endKeepaliveTask()
    }

    // MARK: - Top Navigation Bar
    private func setupTopBar() {
        topBar = UIView()
        topBar.translatesAutoresizingMaskIntoConstraints = false
        topBar.backgroundColor = UIColor(red: 0.13, green: 0.10, blue: 0.19, alpha: 1)
        view.addSubview(topBar)

        tabControl = UISegmentedControl(items: ["⚡ Editor", "💬 WhatsApp (Som)"])
        tabControl.translatesAutoresizingMaskIntoConstraints = false
        tabControl.selectedSegmentIndex = 0
        tabControl.selectedSegmentTintColor = UIColor(red: 0.42, green: 0.24, blue: 0.72, alpha: 1)
        tabControl.backgroundColor = UIColor(red: 0.20, green: 0.15, blue: 0.29, alpha: 1)
        tabControl.setTitleTextAttributes([.foregroundColor: UIColor(white: 0.85, alpha: 1), .font: UIFont.systemFont(ofSize: 13, weight: .semibold)], for: .normal)
        tabControl.setTitleTextAttributes([.foregroundColor: UIColor.white, .font: UIFont.systemFont(ofSize: 13, weight: .bold)], for: .selected)
        tabControl.addTarget(self, action: #selector(tabChanged), for: .valueChanged)
        topBar.addSubview(tabControl)

        reloadButton = UIButton(type: .system)
        reloadButton.translatesAutoresizingMaskIntoConstraints = false
        reloadButton.setTitle("↻", for: .normal)
        reloadButton.setTitleColor(.white, for: .normal)
        reloadButton.titleLabel?.font = UIFont.systemFont(ofSize: 19, weight: .bold)
        reloadButton.backgroundColor = UIColor(red: 0.23, green: 0.17, blue: 0.34, alpha: 1)
        reloadButton.layer.cornerRadius = 16
        reloadButton.isHidden = true
        reloadButton.addTarget(self, action: #selector(reloadWhatsApp), for: .touchUpInside)
        topBar.addSubview(reloadButton)

        let border = UIView()
        border.translatesAutoresizingMaskIntoConstraints = false
        border.backgroundColor = UIColor(red: 0.32, green: 0.24, blue: 0.44, alpha: 0.7)
        topBar.addSubview(border)

        NSLayoutConstraint.activate([
            topBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            topBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            topBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            topBar.heightAnchor.constraint(equalToConstant: 48),

            tabControl.leadingAnchor.constraint(equalTo: topBar.leadingAnchor, constant: 12),
            tabControl.centerYAnchor.constraint(equalTo: topBar.centerYAnchor),
            tabControl.heightAnchor.constraint(equalToConstant: 34),
            tabControl.trailingAnchor.constraint(equalTo: reloadButton.leadingAnchor, constant: -8),

            reloadButton.trailingAnchor.constraint(equalTo: topBar.trailingAnchor, constant: -12),
            reloadButton.centerYAnchor.constraint(equalTo: topBar.centerYAnchor),
            reloadButton.widthAnchor.constraint(equalToConstant: 34),
            reloadButton.heightAnchor.constraint(equalToConstant: 34),

            border.leadingAnchor.constraint(equalTo: topBar.leadingAnchor),
            border.trailingAnchor.constraint(equalTo: topBar.trailingAnchor),
            border.bottomAnchor.constraint(equalTo: topBar.bottomAnchor),
            border.heightAnchor.constraint(equalToConstant: 1)
        ])
    }

    // MARK: - WhatsApp Web + Phone Pairing Helper
    private func setupWhatsAppContainer() {
        waContainer = UIView()
        waContainer.translatesAutoresizingMaskIntoConstraints = false
        waContainer.backgroundColor = UIColor(red: 0.07, green: 0.11, blue: 0.13, alpha: 1)
        view.addSubview(waContainer)

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.preferredContentMode = .desktop
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        let ucc = WKUserContentController()
        ucc.add(self, name: "waBridge")

        // Spoof desktop navigator properties before WhatsApp Web inspects browser capabilities
        let desktopSpoof = """
        (function() {
          try {
            Object.defineProperty(navigator, 'platform', { get: function() { return 'MacIntel'; } });
            Object.defineProperty(navigator, 'maxTouchPoints', { get: function() { return 0; } });
            Object.defineProperty(navigator, 'vendor', { get: function() { return 'Apple Computer, Inc.'; } });
          } catch (e) {}
        })();
        """
        ucc.addUserScript(WKUserScript(source: desktopSpoof, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        // Inject wa-main.js (Pulso audio sticker bridge)
        if let waMainURL = Bundle.main.url(forResource: "wa-main", withExtension: "js", subdirectory: "Web"),
           let waMainSrc = try? String(contentsOf: waMainURL, encoding: .utf8) {
            ucc.addUserScript(WKUserScript(source: waMainSrc, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }

        // Response forwarder + Phone-number login helper & pairing code detector
        let waHelperScript = """
        (function() {
          window.addEventListener("message", function(event) {
            var d = event.data;
            if (!d || d.channel !== "pulso-integracao-v1" || d.direction !== "response") return;
            try {
              window.webkit.messageHandlers.waBridge.postMessage({ type: "rpc", id: d.id, result: d.result });
            } catch (e) {}
          });

          var styleId = "__pulso_wa_login_css";
          function setLoginCss(active) {
            var existing = document.getElementById(styleId);
            if (!active) {
              if (existing) existing.remove();
              return;
            }
            if (existing) return;
            var s = document.createElement("style");
            s.id = styleId;
            s.textContent = [
              "html, body { max-width: 100vw !important; overflow-x: hidden !important; }",
              ".landing-wrapper { min-width: 0 !important; width: 100% !important; padding: 12px !important; box-sizing: border-box !important; }",
              ".landing-window { width: 100% !important; max-width: 100% !important; margin: 0 auto !important; border-radius: 16px !important; }",
              ".landing-main { padding: 18px 14px !important; flex-direction: column !important; align-items: stretch !important; }",
              "input, button, select { font-size: 16px !important; }"
            ].join("\\n");
            (document.head || document.documentElement).appendChild(s);
          }

          window.__pulsoClickPhoneLogin = function() {
            var candidates = Array.from(document.querySelectorAll('button, span[role="button"], a, div[role="button"]'));
            for (var i = 0; i < candidates.length; i++) {
              var el = candidates[i];
              var txt = (el.innerText || el.textContent || "").trim();
              if (/n[uú]mero de telefone|phone number|conectar com n[uú]mero|entrar com n[uú]mero|link with phone/i.test(txt)) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                el.click();
                setTimeout(function() {
                  var inp = document.querySelector('input[type="text"], input[type="tel"], input[aria-label*="telefone" i], input[aria-label*="phone" i]');
                  if (inp) {
                    inp.scrollIntoView({ behavior: "smooth", block: "center" });
                    inp.focus();
                  }
                }, 450);
                return true;
              }
            }
            var inp2 = document.querySelector('input[type="text"], input[type="tel"]');
            if (inp2) {
              inp2.scrollIntoView({ behavior: "smooth", block: "center" });
              inp2.focus();
              return true;
            }
            return false;
          };

          function extractPairingCode() {
            var attrEl = document.querySelector('[data-link-code]');
            if (attrEl) {
              var raw = (attrEl.getAttribute('data-link-code') || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
              if (raw.length === 8) return raw.slice(0, 4) + '-' + raw.slice(4);
            }
            // Fallback: 8 single-character code cells in pairing view
            var spans = Array.from(document.querySelectorAll('[aria-details], [data-testid*="link-code"] span, div[aria-label*="code" i] span, div[aria-label*="código" i] span'));
            var chars = spans.map(function(n) { return (n.textContent || '').trim(); }).filter(function(t) { return /^[A-Z0-9]$/.test(t); });
            if (chars.length === 8) return chars.slice(0, 4).join('') + '-' + chars.slice(4).join('');
            return null;
          }

          var lastLoggedIn = null;
          var lastCode = null;
          setInterval(function() {
            var loggedIn = !!(document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]'));
            setLoginCss(!loggedIn);
            if (loggedIn !== lastLoggedIn) {
              lastLoggedIn = loggedIn;
              try {
                window.webkit.messageHandlers.waBridge.postMessage({ type: "loginState", loggedIn: loggedIn });
              } catch (e) {}
            }
            if (!loggedIn) {
              var code = extractPairingCode();
              if (code !== lastCode) {
                lastCode = code;
                try {
                  window.webkit.messageHandlers.waBridge.postMessage({ type: "pairingCode", code: code || "" });
                } catch (e) {}
              }
            } else if (lastCode !== null) {
              lastCode = null;
              try {
                window.webkit.messageHandlers.waBridge.postMessage({ type: "pairingCode", code: "" });
              } catch (e) {}
            }
          }, 1200);
        })();
        """
        ucc.addUserScript(WKUserScript(source: waHelperScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController = ucc

        waWebView = WKWebView(frame: .zero, configuration: config)
        waWebView.translatesAutoresizingMaskIntoConstraints = false
        waWebView.customUserAgent = desktopUA
        waWebView.navigationDelegate = self
        waWebView.uiDelegate = self
        waWebView.allowsBackForwardNavigationGestures = true
        waContainer.addSubview(waWebView)

        // Native Login Helper Bar (docked at bottom of WhatsApp tab while disconnected)
        waHelperBar = UIView()
        waHelperBar.translatesAutoresizingMaskIntoConstraints = false
        waHelperBar.backgroundColor = UIColor(red: 0.12, green: 0.17, blue: 0.20, alpha: 0.98)
        waHelperBar.layer.borderWidth = 1
        waHelperBar.layer.borderColor = UIColor(red: 0.16, green: 0.65, blue: 0.45, alpha: 0.55).cgColor
        waContainer.addSubview(waHelperBar)

        waHelperTitle = UILabel()
        waHelperTitle.translatesAutoresizingMaskIntoConstraints = false
        waHelperTitle.font = UIFont.systemFont(ofSize: 15, weight: .bold)
        waHelperTitle.textColor = .white
        waHelperTitle.numberOfLines = 1
        waHelperBar.addSubview(waHelperTitle)

        waHelperSubtitle = UILabel()
        waHelperSubtitle.translatesAutoresizingMaskIntoConstraints = false
        waHelperSubtitle.font = UIFont.systemFont(ofSize: 12, weight: .regular)
        waHelperSubtitle.textColor = UIColor(white: 0.82, alpha: 1)
        waHelperSubtitle.numberOfLines = 2
        waHelperBar.addSubview(waHelperSubtitle)

        waHelperButton = UIButton(type: .system)
        waHelperButton.translatesAutoresizingMaskIntoConstraints = false
        waHelperButton.setTitleColor(.white, for: .normal)
        waHelperButton.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .bold)
        waHelperButton.backgroundColor = UIColor(red: 0.14, green: 0.66, blue: 0.42, alpha: 1)
        waHelperButton.layer.cornerRadius = 12
        waHelperButton.addTarget(self, action: #selector(waHelperButtonTapped), for: .touchUpInside)
        waHelperBar.addSubview(waHelperButton)

        NSLayoutConstraint.activate([
            waContainer.topAnchor.constraint(equalTo: topBar.bottomAnchor),
            waContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            waContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            waContainer.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            waWebView.topAnchor.constraint(equalTo: waContainer.topAnchor),
            waWebView.leadingAnchor.constraint(equalTo: waContainer.leadingAnchor),
            waWebView.trailingAnchor.constraint(equalTo: waContainer.trailingAnchor),
            waWebView.bottomAnchor.constraint(equalTo: waContainer.bottomAnchor),

            waHelperBar.leadingAnchor.constraint(equalTo: waContainer.leadingAnchor, constant: 10),
            waHelperBar.trailingAnchor.constraint(equalTo: waContainer.trailingAnchor, constant: -10),
            waHelperBar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),

            waHelperTitle.topAnchor.constraint(equalTo: waHelperBar.topAnchor, constant: 10),
            waHelperTitle.leadingAnchor.constraint(equalTo: waHelperBar.leadingAnchor, constant: 12),
            waHelperTitle.trailingAnchor.constraint(equalTo: waHelperBar.trailingAnchor, constant: -12),

            waHelperSubtitle.topAnchor.constraint(equalTo: waHelperTitle.bottomAnchor, constant: 3),
            waHelperSubtitle.leadingAnchor.constraint(equalTo: waHelperBar.leadingAnchor, constant: 12),
            waHelperSubtitle.trailingAnchor.constraint(equalTo: waHelperBar.trailingAnchor, constant: -12),

            waHelperButton.topAnchor.constraint(equalTo: waHelperSubtitle.bottomAnchor, constant: 8),
            waHelperButton.leadingAnchor.constraint(equalTo: waHelperBar.leadingAnchor, constant: 12),
            waHelperButton.trailingAnchor.constraint(equalTo: waHelperBar.trailingAnchor, constant: -12),
            waHelperButton.heightAnchor.constraint(equalToConstant: 42),
            waHelperButton.bottomAnchor.constraint(equalTo: waHelperBar.bottomAnchor, constant: -10)
        ])
        waHelperBar.layer.cornerRadius = 16
        updateHelperBarUI()
    }

    // MARK: - Pulso Editor WebView
    private func setupEditorContainer() {
        editorContainer = UIView()
        editorContainer.translatesAutoresizingMaskIntoConstraints = false
        editorContainer.backgroundColor = UIColor(red: 0.10, green: 0.08, blue: 0.14, alpha: 1)
        view.addSubview(editorContainer)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.setURLSchemeHandler(PulsoSchemeHandler(), forURLScheme: "pulso")

        let ucc = WKUserContentController()
        ucc.add(self, name: "pulsoEditor")
        if let shimURL = Bundle.main.url(forResource: "ios-shim", withExtension: "js", subdirectory: "Web"),
           let shimSrc = try? String(contentsOf: shimURL, encoding: .utf8) {
            ucc.addUserScript(WKUserScript(source: shimSrc, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        config.userContentController = ucc

        editorWebView = WKWebView(frame: .zero, configuration: config)
        editorWebView.translatesAutoresizingMaskIntoConstraints = false
        editorWebView.isOpaque = false
        editorWebView.backgroundColor = .clear
        editorWebView.uiDelegate = self
        editorContainer.addSubview(editorWebView)

        NSLayoutConstraint.activate([
            editorContainer.topAnchor.constraint(equalTo: topBar.bottomAnchor),
            editorContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            editorContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            editorContainer.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            editorWebView.topAnchor.constraint(equalTo: editorContainer.topAnchor),
            editorWebView.leadingAnchor.constraint(equalTo: editorContainer.leadingAnchor),
            editorWebView.trailingAnchor.constraint(equalTo: editorContainer.trailingAnchor),
            editorWebView.bottomAnchor.constraint(equalTo: editorContainer.bottomAnchor)
        ])

        if let url = URL(string: "pulso://app/editor.html") {
            editorWebView.load(URLRequest(url: url))
        }
    }

    // MARK: - Tab Switching & Helpers
    @objc private func tabChanged() {
        showTab(tabControl.selectedSegmentIndex)
    }

    private func showTab(_ index: Int) {
        tabControl.selectedSegmentIndex = index
        let isEditor = (index == 0)
        editorContainer.isHidden = !isEditor
        waContainer.isHidden = isEditor
        reloadButton.isHidden = isEditor

        if isEditor {
            editorWebView.evaluateJavaScript("window.__pulsoOnShow && window.__pulsoOnShow()", completionHandler: nil)
        } else {
            editorWebView.evaluateJavaScript("window.__pulsoOnHide && window.__pulsoOnHide()", completionHandler: nil)
            if pendingClickPhoneLogin && !isWhatsAppLoggedIn {
                pendingClickPhoneLogin = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
                    self?.triggerPhoneLoginInWebView()
                }
            }
        }
    }

    @objc private func reloadWhatsApp() {
        detectedPairingCode = nil
        updateHelperBarUI()
        waWebView.reload()
    }

    private func updateHelperBarUI() {
        if isWhatsAppLoggedIn {
            waHelperBar.isHidden = true
            tabControl.setTitle("🟢 WhatsApp (Som)", forSegmentAt: 1)
            return
        }
        tabControl.setTitle("💬 WhatsApp (Som)", forSegmentAt: 1)
        waHelperBar.isHidden = false
        if let code = detectedPairingCode, !code.isEmpty {
            waHelperTitle.text = "Código gerado: \(code)"
            waHelperSubtitle.text = "No WhatsApp: Ajustes → Dispositivos conectados → Conectar com número → Cole e volte."
            waHelperButton.setTitle("📋 Copiar Código e Abrir WhatsApp", for: .normal)
            waHelperButton.backgroundColor = UIColor(red: 0.14, green: 0.66, blue: 0.42, alpha: 1)
        } else {
            waHelperTitle.text = "Conectar com seu Número (sem QR Code)"
            waHelperSubtitle.text = "Só precisa para figurinhas COM SOM. Para figurinhas normais, use \"Enviar Pacote\" no Editor!"
            waHelperButton.setTitle("📱 Entrar com Número de Telefone", for: .normal)
            waHelperButton.backgroundColor = UIColor(red: 0.42, green: 0.24, blue: 0.72, alpha: 1)
        }
    }

    @objc private func waHelperButtonTapped() {
        if let code = detectedPairingCode, !code.isEmpty {
            let clean = code.replacingOccurrences(of: "-", with: "")
            UIPasteboard.general.string = clean
            startKeepaliveTask()
            if let waURL = URL(string: "whatsapp://"), UIApplication.shared.canOpenURL(waURL) {
                UIApplication.shared.open(waURL, options: [:], completionHandler: nil)
            } else {
                showAlert(title: "Código copiado: \(code)", message: "Abra o WhatsApp → Ajustes → Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone e cole o código.")
            }
        } else {
            triggerPhoneLoginInWebView()
        }
    }

    private func triggerPhoneLoginInWebView() {
        waWebView.evaluateJavaScript("window.__pulsoClickPhoneLogin && window.__pulsoClickPhoneLogin()") { [weak self] res, _ in
            if let clicked = res as? Bool, !clicked {
                self?.showAlert(title: "Aguarde carregar", message: "Espere a tela do WhatsApp Web terminar de carregar e toque em \"Entrar com Número de Telefone\" novamente.")
            }
        }
    }

    private func loadWhatsApp() {
        if let url = URL(string: "https://web.whatsapp.com/") {
            var req = URLRequest(url: url)
            req.setValue(desktopUA, forHTTPHeaderField: "User-Agent")
            waWebView.load(req)
        }
    }

    // MARK: - Background Keepalive for Single-iPhone Pairing
    private func registerLifecycleObservers() {
        NotificationCenter.default.addObserver(self, selector: #selector(appDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appWillEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc private func appDidEnterBackground() {
        if !isWhatsAppLoggedIn {
            startKeepaliveTask()
        }
    }

    @objc private func appWillEnterForeground() {
        endKeepaliveTask()
    }

    private func startKeepaliveTask() {
        guard backgroundTaskID == .invalid else { return }
        backgroundTaskID = UIApplication.shared.beginBackgroundTask(withName: "PulsoWhatsAppPairing") { [weak self] in
            self?.endKeepaliveTask()
        }
    }

    private func endKeepaliveTask() {
        if backgroundTaskID != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTaskID)
            backgroundTaskID = .invalid
        }
    }

    // MARK: - Native WhatsApp Sticker Pack Export (Sticker.ly method — ZERO login!)
    private func exportStickerPack(reqId: String, body: [String: Any]) {
        guard let rawStickers = body["stickers"] as? [[String: Any]], !rawStickers.isEmpty else {
            resolveEditor(reqId: reqId, jsonValue: "{\"ok\":false,\"detail\":\"Nenhuma figurinha preparada para o pacote.\"}")
            return
        }
        guard let trayPngB64 = body["trayPngBase64"] as? String, !trayPngB64.isEmpty else {
            resolveEditor(reqId: reqId, jsonValue: "{\"ok\":false,\"detail\":\"Ícone do pacote indisponível.\"}")
            return
        }

        let isAnimated = (body["animated"] as? Bool) ?? true
        let rawName = (body["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let rawPublisher = (body["publisher"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let packName = rawName.isEmpty ? "Pulso Stickers" : String(rawName.prefix(128))
        let publisher = rawPublisher.isEmpty ? "Pulso" : String(rawPublisher.prefix(128))

        // WhatsApp iOS requires between 3 and 30 stickers per pack
        var waStickers: [[String: Any]] = []
        for item in rawStickers.prefix(30) {
            guard let b64 = item["webpBase64"] as? String, !b64.isEmpty else { continue }
            let emojis = (item["emojis"] as? [String])?.filter { !$0.isEmpty } ?? ["🔥"]
            waStickers.append([
                "image_data": b64,
                "emojis": Array(emojis.prefix(3))
            ])
        }
        guard !waStickers.isEmpty else {
            resolveEditor(reqId: reqId, jsonValue: "{\"ok\":false,\"detail\":\"Dados WebP inválidos para o pacote.\"}")
            return
        }
        // Pad to 3 stickers if user exported only 1 or 2
        let baseCount = waStickers.count
        var padIdx = 0
        while waStickers.count < 3 {
            waStickers.append(waStickers[padIdx % baseCount])
            padIdx += 1
        }

        let identifier = "pulso.pack.\(Int(Date().timeIntervalSince1970))"
        let payload: [String: Any] = [
            "identifier": identifier,
            "name": packName,
            "publisher": publisher,
            "tray_image": trayPngB64,
            "animated_sticker_pack": isAnimated,
            "ios_app_store_link": "",
            "android_play_store_link": "",
            "stickers": waStickers
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
            resolveEditor(reqId: reqId, jsonValue: "{\"ok\":false,\"detail\":\"Falha ao montar JSON do pacote.\"}")
            return
        }

        guard let waURL = URL(string: "whatsapp://stickerPack") else {
            resolveEditor(reqId: reqId, jsonValue: "{\"ok\":false,\"detail\":\"URL do WhatsApp inválida.\"}")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard UIApplication.shared.canOpenURL(waURL) else {
                self?.resolveEditor(reqId: reqId, jsonValue: "{\"ok\":false,\"detail\":\"WhatsApp não encontrado neste iPhone.\"}")
                return
            }
            let pasteboard = UIPasteboard.general
            let options: [UIPasteboard.OptionsKey: Any] = [
                .localOnly: true,
                .expirationDate: Date(timeIntervalSinceNow: 60)
            ]
            pasteboard.setItems([["net.whatsapp.third-party.sticker-pack": jsonData]], options: options)
            UIApplication.shared.open(waURL, options: [:]) { success in
                if success {
                    self?.resolveEditor(reqId: reqId, jsonValue: "{\"ok\":true,\"detail\":\"Pacote enviado para o WhatsApp! Toque em Salvar no WhatsApp.\"}")
                } else {
                    self?.resolveEditor(reqId: reqId, jsonValue: "{\"ok\":false,\"detail\":\"Não foi possível abrir o WhatsApp.\"}")
                }
            }
        }
    }

    // MARK: - WKNavigationDelegate & WKUIDelegate
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if webView === waWebView {
            if let url = navigationAction.request.url, url.scheme == "whatsapp" {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
                decisionHandler(.cancel, preferences)
                return
            }
            preferences.preferredContentMode = .desktop
        }
        decisionHandler(.allow, preferences)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            if url.scheme == "whatsapp" {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            } else {
                webView.load(URLRequest(url: url))
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let ac = UIAlertController(title: "Pulso", message: message, preferredStyle: .alert)
        ac.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(ac, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let ac = UIAlertController(title: "Pulso", message: message, preferredStyle: .alert)
        ac.addAction(UIAlertAction(title: "Cancelar", style: .cancel) { _ in completionHandler(false) })
        ac.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(ac, animated: true)
    }

    private func showAlert(title: String, message: String) {
        let ac = UIAlertController(title: title, message: message, preferredStyle: .alert)
        ac.addAction(UIAlertAction(title: "OK", style: .default))
        present(ac, animated: true)
    }

    // MARK: - WKScriptMessageHandler
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }

        if message.name == "waBridge" {
            let msgType = body["type"] as? String ?? "rpc"
            if msgType == "loginState" {
                let logged = (body["loggedIn"] as? Bool) ?? false
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    let changed = (self.isWhatsAppLoggedIn != logged)
                    self.isWhatsAppLoggedIn = logged
                    if logged { self.detectedPairingCode = nil }
                    self.updateHelperBarUI()
                    if changed && logged {
                        self.editorWebView.evaluateJavaScript("window.__pulsoOnShow && window.__pulsoOnShow()", completionHandler: nil)
                    }
                }
                return
            }
            if msgType == "pairingCode" {
                let code = (body["code"] as? String) ?? ""
                DispatchQueue.main.async { [weak self] in
                    self?.detectedPairingCode = code.isEmpty ? nil : code
                    self?.updateHelperBarUI()
                }
                return
            }
            guard let id = body["id"] as? String,
                  let cb = pendingRequests.removeValue(forKey: id) else { return }
            let resultObj = body["result"] ?? [:]
            if let data = try? JSONSerialization.data(withJSONObject: resultObj),
               let json = String(data: data, encoding: .utf8) {
                cb(json)
            } else {
                cb("{\"ok\":false,\"detail\":\"Resposta inválida do WhatsApp.\"}")
            }
            return
        }

        if message.name == "pulsoEditor" {
            let action = body["action"] as? String ?? ""
            let reqId = body["id"] as? String ?? ""

            switch action {
            case "close":
                DispatchQueue.main.async { [weak self] in
                    self?.showTab(1)
                }

            case "openWhatsAppTab":
                let clickPhone = (body["clickPhoneLogin"] as? Bool) ?? false
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    self.pendingClickPhoneLogin = clickPhone
                    self.showTab(1)
                }
                resolveEditor(reqId: reqId, jsonValue: "true")

            case "exportStickerPack":
                exportStickerPack(reqId: reqId, body: body)

            case "storageGet":
                let key = body["key"] as? String ?? ""
                let saved = UserDefaults.standard.string(forKey: "pulso_store_" + key) ?? "{}"
                resolveEditor(reqId: reqId, jsonValue: saved)

            case "storageSet":
                let key = body["key"] as? String ?? ""
                let value = body["value"] as? String ?? "{}"
                UserDefaults.standard.set(value, forKey: "pulso_store_" + key)
                resolveEditor(reqId: reqId, jsonValue: "true")

            case "waRequest":
                let what = body["what"] as? String ?? ""
                let payload = body["payload"]
                forwardToWhatsApp(reqId: reqId, what: what, payload: payload)

            case "encodeOpus":
                let pcmB64 = body["pcmBase64"] as? String ?? ""
                let bitrate = body["bitrate"] as? Int ?? 32_000
                DispatchQueue.global(qos: .userInitiated).async {
                    do {
                        guard let pcmData = Data(base64Encoded: pcmB64) else {
                            throw OpusEncoderError.invalidInput
                        }
                        let oggData = try NativeOpusEncoder.encodeToOgg(pcmFloat32Data: pcmData, bitrate: bitrate)
                        let outB64 = oggData.base64EncodedString()
                        let respObj: [String: Any] = ["ok": true, "oggBase64": outB64]
                        let json = String(data: try JSONSerialization.data(withJSONObject: respObj), encoding: .utf8) ?? "{}"
                        DispatchQueue.main.async { self.resolveEditor(reqId: reqId, jsonValue: json) }
                    } catch {
                        let respObj: [String: Any] = ["ok": false, "error": error.localizedDescription]
                        let json = (try? String(data: JSONSerialization.data(withJSONObject: respObj), encoding: .utf8)) ?? "{\"ok\":false}"
                        DispatchQueue.main.async { self.resolveEditor(reqId: reqId, jsonValue: json) }
                    }
                }

            default:
                break
            }
        }
    }

    private func forwardToWhatsApp(reqId: String, what: String, payload: Any?) {
        let msgId = UUID().uuidString.lowercased()
        pendingRequests[msgId] = { [weak self] json in
            self?.resolveEditor(reqId: reqId, jsonValue: json)
        }
        var envelope: [String: Any] = [
            "channel": "pulso-integracao-v1",
            "direction": "request",
            "id": msgId,
            "what": what
        ]
        if let p = payload { envelope["payload"] = p }
        guard let data = try? JSONSerialization.data(withJSONObject: envelope),
              let json = String(data: data, encoding: .utf8) else {
            pendingRequests.removeValue(forKey: msgId)
            resolveEditor(reqId: reqId, jsonValue: "{\"ok\":false,\"detail\":\"Falha ao serializar pedido.\"}")
            return
        }
        let js = "window.postMessage(\(json), location.origin);"
        waWebView.evaluateJavaScript(js) { [weak self] _, err in
            if let err = err {
                self?.pendingRequests.removeValue(forKey: msgId)
                let escaped = err.localizedDescription.replacingOccurrences(of: "\"", with: "\\\"")
                self?.resolveEditor(reqId: reqId, jsonValue: "{\"ok\":false,\"detail\":\"WhatsApp Web indisponível: \(escaped)\"}")
            }
        }
    }

    private func resolveEditor(reqId: String, jsonValue: String) {
        guard !reqId.isEmpty else { return }
        let js = "window.__pulsoNativeResolve && window.__pulsoNativeResolve(\"\(reqId)\", \(jsonValue));"
        editorWebView.evaluateJavaScript(js, completionHandler: nil)
    }
}
