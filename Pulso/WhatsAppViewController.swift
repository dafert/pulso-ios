import UIKit
import WebKit
import AVFoundation

final class WhatsAppViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UITextFieldDelegate {
    private var topBar: UIView!
    private var tabControl: UISegmentedControl!
    private var reloadButton: UIButton!

    private var waContainer: UIView!
    private var waWebView: WKWebView!
    private var pairingScrollView: UIScrollView!
    private var pairingCard: UIView!
    private var ddiField: UITextField!
    private var phoneField: UITextField!
    private var generateButton: UIButton!
    private var pairingStatusLabel: UILabel!
    private var codeBox: UIView!
    private var codeValueLabel: UILabel!
    private var copyOpenButton: UIButton!
    private var toggleWebButton: UIButton!
    private var webBackBar: UIView!
    private var webBackBarHeight: NSLayoutConstraint!
    private var webBackButton: UIButton!

    private var editorContainer: UIView!
    private var editorWebView: WKWebView!

    private var pendingRequests: [String: (String) -> Void] = [:]
    private var isWhatsAppLoggedIn = false
    private var isWebLoaded = false
    private var showingRawWebView = false
    private var detectedPairingCode: String?
    private var backgroundTaskID: UIBackgroundTaskIdentifier = .invalid
    private var silentPlayer: AVAudioPlayer?
    private var keepaliveStopTimer: Timer?

    private let desktopUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15"

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.10, green: 0.08, blue: 0.14, alpha: 1)
        setupTopBar()
        setupWhatsAppContainer()
        setupEditorContainer()
        registerLifecycleObservers()
        showTab(0)
        loadWhatsApp()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        stopBackgroundKeepalive()
    }

    // MARK: - Top Navigation Bar
    private func setupTopBar() {
        topBar = UIView()
        topBar.translatesAutoresizingMaskIntoConstraints = false
        topBar.backgroundColor = UIColor(red: 0.13, green: 0.10, blue: 0.19, alpha: 1)
        view.addSubview(topBar)

        tabControl = UISegmentedControl(items: ["Editor", "Conectar WhatsApp"])
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

    // MARK: - WhatsApp Web + Native Phone Pairing Screen
    private func setupWhatsAppContainer() {
        waContainer = UIView()
        waContainer.translatesAutoresizingMaskIntoConstraints = false
        waContainer.backgroundColor = UIColor(red: 0.09, green: 0.07, blue: 0.13, alpha: 1)
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

        let desktopSpoof = """
        (function() {
          try {
            Object.defineProperty(navigator, 'platform', { get: function() { return 'MacIntel'; } });
            Object.defineProperty(navigator, 'vendor', { get: function() { return 'Apple Computer, Inc.'; } });
          } catch (e) {}
        })();
        """
        ucc.addUserScript(WKUserScript(source: desktopSpoof, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        if let waMainURL = Bundle.main.url(forResource: "wa-main", withExtension: "js", subdirectory: "Web"),
           let waMainSrc = try? String(contentsOf: waMainURL, encoding: .utf8) {
            ucc.addUserScript(WKUserScript(source: waMainSrc, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }

        let waPairingScript = """
        (function() {
          function post(obj) {
            try { window.webkit.messageHandlers.waBridge.postMessage(obj); } catch (e) {}
          }

          window.addEventListener("message", function(event) {
            var d = event.data;
            if (!d || d.channel !== "pulso-integracao-v1" || d.direction !== "response") return;
            post({ type: "rpc", id: d.id, result: d.result });
          });

          // Tiny 0.5s silent WAV loop to keep WebContent alive during pairing
          var keepAudio = null;
          window.__pulsoKeepWebAlive = function(enable) {
            try {
              if (!enable) {
                if (keepAudio) { keepAudio.pause(); keepAudio = null; }
                return;
              }
              if (keepAudio) { keepAudio.play().catch(function(){}); return; }
              var sampleRate = 8000, numSamples = 4000;
              var buf = new ArrayBuffer(44 + numSamples * 2);
              var dv = new DataView(buf);
              function ws(off, str) { for (var i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i)); }
              ws(0, 'RIFF'); dv.setUint32(4, 36 + numSamples * 2, true);
              ws(8, 'WAVE'); ws(12, 'fmt '); dv.setUint32(16, 16, true);
              dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
              dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true);
              dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
              ws(36, 'data'); dv.setUint32(40, numSamples * 2, true);
              var blob = new Blob([buf], { type: 'audio/wav' });
              keepAudio = new Audio(URL.createObjectURL(blob));
              keepAudio.loop = true;
              keepAudio.volume = 0.01;
              keepAudio.play().catch(function(){});
            } catch (e) {}
          };

          var styleId = "__pulso_wa_login_css";
          function setLoginCss(active) {
            var existing = document.getElementById(styleId);
            if (!active) { if (existing) existing.remove(); return; }
            if (existing) return;
            var s = document.createElement("style");
            s.id = styleId;
            s.textContent = [
              "html, body { max-width: 100vw !important; overflow-x: hidden !important; }",
              ".landing-wrapper { min-width: 0 !important; width: 100% !important; padding: 10px !important; box-sizing: border-box !important; }",
              ".landing-window { width: 100% !important; max-width: 100% !important; margin: 0 auto !important; border-radius: 14px !important; }",
              ".landing-main { padding: 16px 12px !important; flex-direction: column !important; align-items: stretch !important; }",
              "input, button, select { font-size: 16px !important; }"
            ].join("\\n");
            (document.head || document.documentElement).appendChild(s);
          }

          function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

          function isVisible(el) {
            if (!el) return false;
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          }

          function findPhoneInput() {
            var selectors = [
              'input[aria-label*="telefone" i]',
              'input[aria-label*="phone" i]',
              'input[type="tel"]',
              'form input[type="text"]',
              'input[inputmode="tel"]',
              'input[value^="+"]'
            ];
            for (var i = 0; i < selectors.length; i++) {
              var list = document.querySelectorAll(selectors[i]);
              for (var j = 0; j < list.length; j++) {
                if (isVisible(list[j])) return list[j];
              }
            }
            return null;
          }

          function clickPhoneLoginLink() {
            var all = Array.from(document.querySelectorAll('button, a, span[role="button"], div[role="button"], span, div'));
            for (var i = 0; i < all.length; i++) {
              var el = all[i];
              if (!isVisible(el)) continue;
              if (el.children && el.children.length > 2) continue;
              var txt = (el.innerText || el.textContent || "").trim();
              if (!txt || txt.length > 75) continue;
              if (/n[uú]mero de telefone|phone number|conectar com n[uú]mero|entrar com n[uú]mero|link with phone|log in with phone/i.test(txt)) {
                var target = el.closest('button, a, [role="button"]') || el;
                target.scrollIntoView({ behavior: "instant", block: "center" });
                target.click();
                return true;
              }
            }
            return false;
          }

          function findNextButton() {
            var btns = Array.from(document.querySelectorAll('button, [role="button"]'));
            for (var i = 0; i < btns.length; i++) {
              var b = btns[i];
              if (!isVisible(b) || b.disabled) continue;
              var txt = (b.innerText || b.textContent || "").trim();
              if (/^(avan[cç]ar|next|continuar|prosseguir)$/i.test(txt)) return b;
            }
            return null;
          }

          function extractPairingCode() {
            var attrEl = document.querySelector('[data-link-code]');
            if (attrEl) {
              var raw = (attrEl.getAttribute('data-link-code') || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
              if (raw.length === 8) return raw.slice(0, 4) + '-' + raw.slice(4);
            }
            var ariaEl = document.querySelector('[aria-label*="código" i], [aria-label*="code" i]');
            if (ariaEl) {
              var m = (ariaEl.getAttribute('aria-label') || '').match(/\\b([A-Z0-9]{4})[-\\s]?([A-Z0-9]{4})\\b/);
              if (m) return m[1] + '-' + m[2];
            }
            // Scan containers with 8 single-char alphanumeric cells
            var containers = Array.from(document.querySelectorAll('div'));
            for (var i = 0; i < containers.length; i++) {
              var c = containers[i];
              if (!isVisible(c)) continue;
              var spans = Array.from(c.querySelectorAll('span'));
              if (spans.length >= 8 && spans.length <= 16) {
                var chars = spans.map(function(n) { return (n.textContent || '').trim(); }).filter(function(t) { return /^[A-Z0-9]$/.test(t); });
                if (chars.length === 8) return chars.slice(0, 4).join('') + '-' + chars.slice(4).join('');
              }
            }
            return null;
          }

          function fillReactInput(inp, value) {
            inp.focus();
            try { inp.select(); } catch (e) {}
            try {
              document.execCommand('selectAll', false, null);
              document.execCommand('insertText', false, value);
            } catch (e) {}
            try {
              var proto = window.HTMLInputElement.prototype;
              var desc = Object.getOwnPropertyDescriptor(proto, 'value');
              if (desc && desc.set) desc.set.call(inp, value);
              else inp.value = value;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {}
          }

          window.__pulsoStartPhonePairing = async function(ddiDigits, localDigits) {
            window.__pulsoKeepWebAlive(true);
            var fullPlus = '+' + ddiDigits + localDigits;
            post({ type: "pairingStatus", text: "Aguardando WhatsApp Web ficar pronto…" });

            // 1. Wait up to 15s for login UI or chat list
            var ready = false;
            for (var t = 0; t < 50; t++) {
              if (document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]')) {
                post({ type: "loginState", loggedIn: true });
                return;
              }
              if (findPhoneInput() || extractPairingCode() || document.querySelector('canvas') || document.querySelector('[data-ref]')) {
                ready = true;
                break;
              }
              await sleep(300);
            }

            if (extractPairingCode()) {
              post({ type: "pairingCode", code: extractPairingCode() });
              return;
            }

            // 2. Click "Entrar com número de telefone" if phone input not yet visible
            var inp = findPhoneInput();
            if (!inp) {
              post({ type: "pairingStatus", text: "Abrindo login por número de telefone…" });
              var clicked = false;
              for (var k = 0; k < 20; k++) {
                if (clickPhoneLoginLink()) { clicked = true; break; }
                await sleep(350);
              }
              if (!clicked) {
                post({ type: "pairingError", text: "Não encontrei o botão 'Entrar com número' automaticamente. Mostrando a tela do WhatsApp para você tocar nele." });
                return;
              }
              for (var w = 0; w < 25; w++) {
                inp = findPhoneInput();
                if (inp) break;
                await sleep(300);
              }
            }

            if (!inp) {
              post({ type: "pairingError", text: "Campo de número não apareceu. Digite seu número direto na tela do WhatsApp abaixo." });
              return;
            }

            // 3. Fill phone number (respecting whether input expects '+55...' or local digits)
            post({ type: "pairingStatus", text: "Preenchendo seu número e solicitando código…" });
            var cur = (inp.value || '').trim();
            var ph = (inp.getAttribute('placeholder') || '').trim();
            var valueToType = (cur.indexOf('+') === 0 || ph.indexOf('+') === 0 || cur === '') ? fullPlus : localDigits;
            fillReactInput(inp, valueToType);
            await sleep(450);

            // 4. Click Next / Avançar
            var nextBtn = findNextButton();
            if (!nextBtn) {
              post({ type: "pairingError", text: "Número preenchido! Toque em Avançar na tela abaixo para gerar o código." });
              return;
            }
            nextBtn.click();
            post({ type: "pairingStatus", text: "Gerando código de 8 dígitos…" });

            // 5. Wait up to 20s for the 8-char code
            for (var c = 0; c < 65; c++) {
              if (document.querySelector('#pane-side')) {
                post({ type: "loginState", loggedIn: true });
                return;
              }
              var code = extractPairingCode();
              if (code) {
                post({ type: "pairingCode", code: code });
                return;
              }
              await sleep(300);
            }
            post({ type: "pairingError", text: "O WhatsApp demorou para responder. Confira a tela abaixo (verifique o DDI/DDD e toque em Avançar)." });
          };

          var lastLoggedIn = null;
          var lastCode = null;
          var sentReady = false;
          setInterval(function() {
            var loggedIn = !!(document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]'));
            setLoginCss(!loggedIn);
            if (!sentReady && (loggedIn || document.querySelector('canvas') || findPhoneInput())) {
              sentReady = true;
              post({ type: "webReady" });
            }
            if (loggedIn !== lastLoggedIn) {
              lastLoggedIn = loggedIn;
              if (loggedIn) window.__pulsoKeepWebAlive(false);
              post({ type: "loginState", loggedIn: loggedIn });
            }
            if (!loggedIn) {
              var code = extractPairingCode();
              if (code !== lastCode) {
                lastCode = code;
                post({ type: "pairingCode", code: code || "" });
              }
            } else if (lastCode !== null) {
              lastCode = null;
              post({ type: "pairingCode", code: "" });
            }
          }, 1000);
        })();
        """
        ucc.addUserScript(WKUserScript(source: waPairingScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController = ucc

        waWebView = WKWebView(frame: .zero, configuration: config)
        waWebView.translatesAutoresizingMaskIntoConstraints = false
        waWebView.customUserAgent = desktopUA
        waWebView.navigationDelegate = self
        waWebView.uiDelegate = self
        waWebView.allowsBackForwardNavigationGestures = true
        waContainer.addSubview(waWebView)

        // Bar shown when viewing raw WhatsApp Web while disconnected
        webBackBar = UIView()
        webBackBar.translatesAutoresizingMaskIntoConstraints = false
        webBackBar.backgroundColor = UIColor(red: 0.14, green: 0.11, blue: 0.21, alpha: 1)
        webBackBar.isHidden = true
        waContainer.addSubview(webBackBar)

        webBackButton = UIButton(type: .system)
        webBackButton.translatesAutoresizingMaskIntoConstraints = false
        webBackButton.setTitle("← Voltar para tela simplificada por número", for: .normal)
        webBackButton.setTitleColor(UIColor(red: 0.85, green: 0.73, blue: 1.0, alpha: 1), for: .normal)
        webBackButton.titleLabel?.font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        webBackButton.addTarget(self, action: #selector(toggleRawWebView), for: .touchUpInside)
        webBackBar.addSubview(webBackButton)

        // Native Phone Number Pairing Overlay (hides ugly WhatsApp Web screen until connected!)
        pairingScrollView = UIScrollView()
        pairingScrollView.translatesAutoresizingMaskIntoConstraints = false
        pairingScrollView.backgroundColor = UIColor(red: 0.09, green: 0.07, blue: 0.13, alpha: 1)
        pairingScrollView.keyboardDismissMode = .interactive
        waContainer.addSubview(pairingScrollView)

        pairingCard = UIView()
        pairingCard.translatesAutoresizingMaskIntoConstraints = false
        pairingCard.backgroundColor = UIColor(red: 0.14, green: 0.11, blue: 0.20, alpha: 1)
        pairingCard.layer.cornerRadius = 20
        pairingCard.layer.borderWidth = 1
        pairingCard.layer.borderColor = UIColor(red: 0.36, green: 0.27, blue: 0.50, alpha: 0.8).cgColor
        pairingScrollView.addSubview(pairingCard)

        let titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = "Conectar WhatsApp"
        titleLabel.font = UIFont.systemFont(ofSize: 22, weight: .bold)
        titleLabel.textColor = .white
        pairingCard.addSubview(titleLabel)

        let subLabel = UILabel()
        subLabel.translatesAutoresizingMaskIntoConstraints = false
        subLabel.text = "Conecte 1 única vez usando seu número — sem QR Code e sem outro celular — para enviar figurinhas com som."
        subLabel.font = UIFont.systemFont(ofSize: 13.5, weight: .regular)
        subLabel.textColor = UIColor(white: 0.78, alpha: 1)
        subLabel.numberOfLines = 0
        pairingCard.addSubview(subLabel)

        let toolbar = UIToolbar()
        toolbar.sizeToFit()
        toolbar.items = [
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
            UIBarButtonItem(title: "OK", style: .done, target: self, action: #selector(dismissKeyboard))
        ]

        ddiField = UITextField()
        ddiField.translatesAutoresizingMaskIntoConstraints = false
        ddiField.text = "+55"
        ddiField.textColor = .white
        ddiField.textAlignment = .center
        ddiField.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        ddiField.backgroundColor = UIColor(red: 0.20, green: 0.15, blue: 0.28, alpha: 1)
        ddiField.layer.cornerRadius = 12
        ddiField.layer.borderWidth = 1
        ddiField.layer.borderColor = UIColor(red: 0.42, green: 0.31, blue: 0.58, alpha: 0.8).cgColor
        ddiField.keyboardType = .phonePad
        ddiField.inputAccessoryView = toolbar
        ddiField.delegate = self
        pairingCard.addSubview(ddiField)

        phoneField = UITextField()
        phoneField.translatesAutoresizingMaskIntoConstraints = false
        phoneField.attributedPlaceholder = NSAttributedString(
            string: "DDD + Número (ex: 11999999999)",
            attributes: [.foregroundColor: UIColor(white: 0.55, alpha: 1)]
        )
        phoneField.textColor = .white
        phoneField.font = UIFont.systemFont(ofSize: 17, weight: .medium)
        phoneField.backgroundColor = UIColor(red: 0.20, green: 0.15, blue: 0.28, alpha: 1)
        phoneField.layer.cornerRadius = 12
        phoneField.layer.borderWidth = 1
        phoneField.layer.borderColor = UIColor(red: 0.42, green: 0.31, blue: 0.58, alpha: 0.8).cgColor
        phoneField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
        phoneField.leftViewMode = .always
        phoneField.keyboardType = .phonePad
        phoneField.inputAccessoryView = toolbar
        phoneField.delegate = self
        if let savedPhone = UserDefaults.standard.string(forKey: "pulso_last_phone") {
            phoneField.text = savedPhone
        }
        pairingCard.addSubview(phoneField)

        generateButton = UIButton(type: .system)
        generateButton.translatesAutoresizingMaskIntoConstraints = false
        generateButton.setTitle("Gerar código de 8 dígitos", for: .normal)
        generateButton.setTitleColor(.white, for: .normal)
        generateButton.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .bold)
        generateButton.backgroundColor = UIColor(red: 0.46, green: 0.26, blue: 0.82, alpha: 1)
        generateButton.layer.cornerRadius = 14
        generateButton.addTarget(self, action: #selector(generateCodeTapped), for: .touchUpInside)
        pairingCard.addSubview(generateButton)

        pairingStatusLabel = UILabel()
        pairingStatusLabel.translatesAutoresizingMaskIntoConstraints = false
        pairingStatusLabel.text = "Carregando conexão com o WhatsApp…"
        pairingStatusLabel.font = UIFont.systemFont(ofSize: 13, weight: .medium)
        pairingStatusLabel.textColor = UIColor(red: 0.82, green: 0.72, blue: 0.98, alpha: 1)
        pairingStatusLabel.numberOfLines = 0
        pairingStatusLabel.textAlignment = .center
        pairingCard.addSubview(pairingStatusLabel)

        // Code Box (revealed once 8-char code arrives)
        codeBox = UIView()
        codeBox.translatesAutoresizingMaskIntoConstraints = false
        codeBox.backgroundColor = UIColor(red: 0.08, green: 0.22, blue: 0.16, alpha: 1)
        codeBox.layer.cornerRadius = 16
        codeBox.layer.borderWidth = 1.5
        codeBox.layer.borderColor = UIColor(red: 0.18, green: 0.76, blue: 0.48, alpha: 0.85).cgColor
        codeBox.isHidden = true
        pairingCard.addSubview(codeBox)

        let codeHeader = UILabel()
        codeHeader.translatesAutoresizingMaskIntoConstraints = false
        codeHeader.text = "SEU CÓDIGO DE CONEXÃO"
        codeHeader.font = UIFont.systemFont(ofSize: 11.5, weight: .bold)
        codeHeader.textColor = UIColor(red: 0.56, green: 0.94, blue: 0.74, alpha: 1)
        codeHeader.textAlignment = .center
        codeBox.addSubview(codeHeader)

        codeValueLabel = UILabel()
        codeValueLabel.translatesAutoresizingMaskIntoConstraints = false
        codeValueLabel.text = "---- ----"
        codeValueLabel.font = UIFont.monospacedSystemFont(ofSize: 30, weight: .heavy)
        codeValueLabel.textColor = .white
        codeValueLabel.textAlignment = .center
        codeBox.addSubview(codeValueLabel)

        copyOpenButton = UIButton(type: .system)
        copyOpenButton.translatesAutoresizingMaskIntoConstraints = false
        copyOpenButton.setTitle("Copiar código e abrir WhatsApp", for: .normal)
        copyOpenButton.setTitleColor(.white, for: .normal)
        copyOpenButton.titleLabel?.font = UIFont.systemFont(ofSize: 15.5, weight: .bold)
        copyOpenButton.backgroundColor = UIColor(red: 0.14, green: 0.67, blue: 0.42, alpha: 1)
        copyOpenButton.layer.cornerRadius = 12
        copyOpenButton.addTarget(self, action: #selector(copyCodeAndOpenWhatsApp), for: .touchUpInside)
        codeBox.addSubview(copyOpenButton)

        let stepsLabel = UILabel()
        stepsLabel.translatesAutoresizingMaskIntoConstraints = false
        stepsLabel.text = "1. Toque no botão verde acima (copia o código e mantém a conexão ativa).\n2. No WhatsApp: Ajustes → Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone.\n3. Cole o código e volte aqui pro Pulso!"
        stepsLabel.font = UIFont.systemFont(ofSize: 12.5, weight: .regular)
        stepsLabel.textColor = UIColor(white: 0.88, alpha: 1)
        stepsLabel.numberOfLines = 0
        codeBox.addSubview(stepsLabel)

        toggleWebButton = UIButton(type: .system)
        toggleWebButton.translatesAutoresizingMaskIntoConstraints = false
        toggleWebButton.setTitle("Mostrar WhatsApp Web / QR Code", for: .normal)
        toggleWebButton.setTitleColor(UIColor(white: 0.78, alpha: 1), for: .normal)
        toggleWebButton.titleLabel?.font = UIFont.systemFont(ofSize: 13.5, weight: .semibold)
        toggleWebButton.backgroundColor = UIColor(red: 0.20, green: 0.15, blue: 0.28, alpha: 1)
        toggleWebButton.layer.cornerRadius = 12
        toggleWebButton.addTarget(self, action: #selector(toggleRawWebView), for: .touchUpInside)
        pairingCard.addSubview(toggleWebButton)

        let phoneRow = UIView()
        phoneRow.translatesAutoresizingMaskIntoConstraints = false
        phoneRow.addSubview(ddiField)
        phoneRow.addSubview(phoneField)
        NSLayoutConstraint.activate([
            ddiField.topAnchor.constraint(equalTo: phoneRow.topAnchor),
            ddiField.bottomAnchor.constraint(equalTo: phoneRow.bottomAnchor),
            ddiField.leadingAnchor.constraint(equalTo: phoneRow.leadingAnchor),
            ddiField.widthAnchor.constraint(equalToConstant: 66),
            ddiField.heightAnchor.constraint(equalToConstant: 48),

            phoneField.topAnchor.constraint(equalTo: phoneRow.topAnchor),
            phoneField.bottomAnchor.constraint(equalTo: phoneRow.bottomAnchor),
            phoneField.leadingAnchor.constraint(equalTo: ddiField.trailingAnchor, constant: 8),
            phoneField.trailingAnchor.constraint(equalTo: phoneRow.trailingAnchor),
            phoneField.heightAnchor.constraint(equalToConstant: 48)
        ])

        let cardStack = UIStackView(arrangedSubviews: [
            titleLabel,
            subLabel,
            phoneRow,
            generateButton,
            pairingStatusLabel,
            codeBox,
            toggleWebButton
        ])
        cardStack.translatesAutoresizingMaskIntoConstraints = false
        cardStack.axis = .vertical
        cardStack.spacing = 12
        cardStack.setCustomSpacing(6, after: titleLabel)
        cardStack.setCustomSpacing(16, after: subLabel)
        pairingCard.addSubview(cardStack)

        webBackBarHeight = webBackBar.heightAnchor.constraint(equalToConstant: 0)

        NSLayoutConstraint.activate([
            waContainer.topAnchor.constraint(equalTo: topBar.bottomAnchor),
            waContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            waContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            waContainer.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            webBackBar.topAnchor.constraint(equalTo: waContainer.topAnchor),
            webBackBar.leadingAnchor.constraint(equalTo: waContainer.leadingAnchor),
            webBackBar.trailingAnchor.constraint(equalTo: waContainer.trailingAnchor),
            webBackBarHeight,

            webBackButton.centerXAnchor.constraint(equalTo: webBackBar.centerXAnchor),
            webBackButton.centerYAnchor.constraint(equalTo: webBackBar.centerYAnchor),

            waWebView.topAnchor.constraint(equalTo: webBackBar.bottomAnchor),
            waWebView.leadingAnchor.constraint(equalTo: waContainer.leadingAnchor),
            waWebView.trailingAnchor.constraint(equalTo: waContainer.trailingAnchor),
            waWebView.bottomAnchor.constraint(equalTo: waContainer.bottomAnchor),

            pairingScrollView.topAnchor.constraint(equalTo: waContainer.topAnchor),
            pairingScrollView.leadingAnchor.constraint(equalTo: waContainer.leadingAnchor),
            pairingScrollView.trailingAnchor.constraint(equalTo: waContainer.trailingAnchor),
            pairingScrollView.bottomAnchor.constraint(equalTo: waContainer.bottomAnchor),

            pairingCard.topAnchor.constraint(equalTo: pairingScrollView.contentLayoutGuide.topAnchor, constant: 18),
            pairingCard.leadingAnchor.constraint(equalTo: pairingScrollView.frameLayoutGuide.leadingAnchor, constant: 14),
            pairingCard.trailingAnchor.constraint(equalTo: pairingScrollView.frameLayoutGuide.trailingAnchor, constant: -14),
            pairingCard.bottomAnchor.constraint(equalTo: pairingScrollView.contentLayoutGuide.bottomAnchor, constant: -24),

            cardStack.topAnchor.constraint(equalTo: pairingCard.topAnchor, constant: 18),
            cardStack.leadingAnchor.constraint(equalTo: pairingCard.leadingAnchor, constant: 16),
            cardStack.trailingAnchor.constraint(equalTo: pairingCard.trailingAnchor, constant: -16),
            cardStack.bottomAnchor.constraint(equalTo: pairingCard.bottomAnchor, constant: -18),

            generateButton.heightAnchor.constraint(equalToConstant: 48),
            toggleWebButton.heightAnchor.constraint(equalToConstant: 42),

            codeHeader.topAnchor.constraint(equalTo: codeBox.topAnchor, constant: 12),
            codeHeader.leadingAnchor.constraint(equalTo: codeBox.leadingAnchor, constant: 12),
            codeHeader.trailingAnchor.constraint(equalTo: codeBox.trailingAnchor, constant: -12),

            codeValueLabel.topAnchor.constraint(equalTo: codeHeader.bottomAnchor, constant: 4),
            codeValueLabel.leadingAnchor.constraint(equalTo: codeBox.leadingAnchor, constant: 12),
            codeValueLabel.trailingAnchor.constraint(equalTo: codeBox.trailingAnchor, constant: -12),

            copyOpenButton.topAnchor.constraint(equalTo: codeValueLabel.bottomAnchor, constant: 12),
            copyOpenButton.leadingAnchor.constraint(equalTo: codeBox.leadingAnchor, constant: 12),
            copyOpenButton.trailingAnchor.constraint(equalTo: codeBox.trailingAnchor, constant: -12),
            copyOpenButton.heightAnchor.constraint(equalToConstant: 46),

            stepsLabel.topAnchor.constraint(equalTo: copyOpenButton.bottomAnchor, constant: 10),
            stepsLabel.leadingAnchor.constraint(equalTo: codeBox.leadingAnchor, constant: 12),
            stepsLabel.trailingAnchor.constraint(equalTo: codeBox.trailingAnchor, constant: -12),
            stepsLabel.bottomAnchor.constraint(equalTo: codeBox.bottomAnchor, constant: -12)
        ])

        updateWhatsAppUI()
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

    // MARK: - Actions & State
    @objc private func dismissKeyboard() {
        view.endEditing(true)
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        return true
    }

    @objc private func tabChanged() {
        dismissKeyboard()
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
        }
    }

    @objc private func reloadWhatsApp() {
        detectedPairingCode = nil
        isWebLoaded = false
        pairingStatusLabel.text = "Recarregando WhatsApp Web…"
        updateWhatsAppUI()
        waWebView.reload()
    }

    @objc private func toggleRawWebView() {
        dismissKeyboard()
        showingRawWebView.toggle()
        updateWhatsAppUI()
    }

    private func updateWhatsAppUI() {
        if isWhatsAppLoggedIn {
            tabControl.setTitle("WhatsApp conectado", forSegmentAt: 1)
            pairingScrollView.isHidden = true
            webBackBar.isHidden = true
            webBackBarHeight.constant = 0
            return
        }
        tabControl.setTitle("Conectar WhatsApp", forSegmentAt: 1)
        pairingScrollView.isHidden = showingRawWebView
        webBackBar.isHidden = !showingRawWebView
        webBackBarHeight.constant = showingRawWebView ? 40 : 0

        if let code = detectedPairingCode, !code.isEmpty {
            codeBox.isHidden = false
            codeValueLabel.text = code
            pairingStatusLabel.text = "Código gerado! Copie e cole no seu WhatsApp agora."
            pairingStatusLabel.textColor = UIColor(red: 0.56, green: 0.94, blue: 0.74, alpha: 1)
        } else {
            codeBox.isHidden = true
        }
    }

    @objc private func generateCodeTapped() {
        dismissKeyboard()
        let ddi = (ddiField.text ?? "55").filter { $0.isNumber }
        let local = (phoneField.text ?? "").filter { $0.isNumber }
        guard !ddi.isEmpty, local.count >= 8 else {
            pairingStatusLabel.text = "Digite o DDD + seu número (ex: 11999999999)."
            pairingStatusLabel.textColor = UIColor(red: 1.0, green: 0.62, blue: 0.70, alpha: 1)
            return
        }
        UserDefaults.standard.set(local, forKey: "pulso_last_phone")
        detectedPairingCode = nil
        codeBox.isHidden = true
        pairingStatusLabel.textColor = UIColor(red: 0.82, green: 0.72, blue: 0.98, alpha: 1)
        pairingStatusLabel.text = "Solicitando código de 8 dígitos…"

        startBackgroundKeepalive()
        let js = "window.__pulsoStartPhonePairing && window.__pulsoStartPhonePairing('\(ddi)', '\(local)');"
        waWebView.evaluateJavaScript(js, completionHandler: nil)
    }

    @objc private func copyCodeAndOpenWhatsApp() {
        guard let code = detectedPairingCode, !code.isEmpty else { return }
        let clean = code.replacingOccurrences(of: "-", with: "")
        UIPasteboard.general.string = clean
        startBackgroundKeepalive()
        pairingStatusLabel.text = "Código \(code) copiado! Cole no WhatsApp e volte aqui."
        if let waURL = URL(string: "whatsapp://"), UIApplication.shared.canOpenURL(waURL) {
            UIApplication.shared.open(waURL, options: [:], completionHandler: nil)
        } else {
            showAlert(title: "Código copiado: \(code)", message: "Abra o WhatsApp → Ajustes → Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone e cole o código.")
        }
    }

    private func loadWhatsApp() {
        if let url = URL(string: "https://web.whatsapp.com/") {
            var req = URLRequest(url: url)
            req.setValue(desktopUA, forHTTPHeaderField: "User-Agent")
            waWebView.load(req)
        }
    }

    // MARK: - Background Keepalive (Silent Audio + BackgroundTask during Pairing ONLY)
    private func registerLifecycleObservers() {
        NotificationCenter.default.addObserver(self, selector: #selector(appDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appWillEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc private func appDidEnterBackground() {
        if !isWhatsAppLoggedIn && (detectedPairingCode != nil || silentPlayer?.isPlaying == true) {
            startBackgroundKeepalive()
        }
    }

    @objc private func appWillEnterForeground() {
        if isWhatsAppLoggedIn {
            stopBackgroundKeepalive()
        } else if backgroundTaskID != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTaskID)
            backgroundTaskID = .invalid
        }
    }

    private func startBackgroundKeepalive() {
        if backgroundTaskID == .invalid {
            backgroundTaskID = UIApplication.shared.beginBackgroundTask(withName: "PulsoWhatsAppPairing") { [weak self] in
                guard let self = self else { return }
                if self.backgroundTaskID != .invalid {
                    UIApplication.shared.endBackgroundTask(self.backgroundTaskID)
                    self.backgroundTaskID = .invalid
                }
            }
        }
        if silentPlayer == nil {
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
                try session.setActive(true)
                let wav = makeSilentWavData()
                let player = try AVAudioPlayer(data: wav)
                player.numberOfLoops = -1
                player.volume = 0.01
                player.prepareToPlay()
                player.play()
                silentPlayer = player
            } catch {}
        } else if silentPlayer?.isPlaying == false {
            silentPlayer?.play()
        }
        waWebView.evaluateJavaScript("window.__pulsoKeepWebAlive && window.__pulsoKeepWebAlive(true);", completionHandler: nil)

        // Auto-stop keepalive after 3 minutes so battery is never wasted
        keepaliveStopTimer?.invalidate()
        keepaliveStopTimer = Timer.scheduledTimer(withTimeInterval: 180, repeats: false) { [weak self] _ in
            self?.stopBackgroundKeepalive()
        }
    }

    private func stopBackgroundKeepalive() {
        keepaliveStopTimer?.invalidate()
        keepaliveStopTimer = nil
        silentPlayer?.stop()
        silentPlayer = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        waWebView?.evaluateJavaScript("window.__pulsoKeepWebAlive && window.__pulsoKeepWebAlive(false);", completionHandler: nil)
        if backgroundTaskID != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTaskID)
            backgroundTaskID = .invalid
        }
    }

    private func makeSilentWavData() -> Data {
        let sampleRate: UInt32 = 8000
        let numSamples: UInt32 = 8000 // 1 second
        let dataSize: UInt32 = numSamples * 2
        let chunkSize: UInt32 = 36 + dataSize
        var data = Data()
        data.append(contentsOf: "RIFF".utf8)
        var cs = chunkSize.littleEndian
        data.append(Data(bytes: &cs, count: 4))
        data.append(contentsOf: "WAVEfmt ".utf8)
        var sub1: UInt32 = 16
        data.append(Data(bytes: &sub1, count: 4))
        var audioFmt: UInt16 = 1
        data.append(Data(bytes: &audioFmt, count: 2))
        var channels: UInt16 = 1
        data.append(Data(bytes: &channels, count: 2))
        var sr = sampleRate.littleEndian
        data.append(Data(bytes: &sr, count: 4))
        var byteRate = (sampleRate * 2).littleEndian
        data.append(Data(bytes: &byteRate, count: 4))
        var blockAlign: UInt16 = 2
        data.append(Data(bytes: &blockAlign, count: 2))
        var bitsPerSample: UInt16 = 16
        data.append(Data(bytes: &bitsPerSample, count: 2))
        data.append(contentsOf: "data".utf8)
        var ds = dataSize.littleEndian
        data.append(Data(bytes: &ds, count: 4))
        data.append(Data(count: Int(dataSize)))
        return data
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
            switch msgType {
            case "webReady":
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    self.isWebLoaded = true
                    if !self.isWhatsAppLoggedIn && self.detectedPairingCode == nil {
                        self.pairingStatusLabel.text = "Pronto! Digite seu DDD + número e toque em Gerar Código."
                        self.pairingStatusLabel.textColor = UIColor(red: 0.82, green: 0.72, blue: 0.98, alpha: 1)
                    }
                }
                return

            case "pairingStatus":
                let txt = (body["text"] as? String) ?? ""
                DispatchQueue.main.async { [weak self] in
                    self?.pairingStatusLabel.text = txt
                    self?.pairingStatusLabel.textColor = UIColor(red: 0.82, green: 0.72, blue: 0.98, alpha: 1)
                }
                return

            case "pairingError":
                let txt = (body["text"] as? String) ?? "Não foi possível gerar o código automaticamente."
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    self.pairingStatusLabel.text = txt
                    self.pairingStatusLabel.textColor = UIColor(red: 1.0, green: 0.62, blue: 0.70, alpha: 1)
                    // Reveal raw WhatsApp Web so user can complete directly if needed
                    self.showingRawWebView = true
                    self.updateWhatsAppUI()
                }
                return

            case "pairingCode":
                let code = (body["code"] as? String) ?? ""
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    self.detectedPairingCode = code.isEmpty ? nil : code
                    if !code.isEmpty {
                        self.showingRawWebView = false
                    }
                    self.updateWhatsAppUI()
                }
                return

            case "loginState":
                let logged = (body["loggedIn"] as? Bool) ?? false
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    let becameLoggedIn = (!self.isWhatsAppLoggedIn && logged)
                    self.isWhatsAppLoggedIn = logged
                    if logged {
                        self.detectedPairingCode = nil
                        self.showingRawWebView = false
                        self.stopBackgroundKeepalive()
                    }
                    self.updateWhatsAppUI()
                    if becameLoggedIn {
                        self.showTab(0)
                        self.showAlert(title: "WhatsApp conectado", message: "Escolha um vídeo no Editor para criar e enviar figurinhas com som.")
                    }
                }
                return

            default:
                break
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
                DispatchQueue.main.async { [weak self] in
                    self?.showTab(1)
                }
                resolveEditor(reqId: reqId, jsonValue: "true")

            case "storageGet":
                let key = body["key"] as? String ?? ""
                guard isSafeIdentifier(key) else {
                    resolveEditor(reqId: reqId, jsonValue: "{}")
                    return
                }
                let raw = UserDefaults.standard.string(forKey: "pulso_store_" + key) ?? "{}"
                resolveEditor(reqId: reqId, jsonValue: validatedJsonString(raw))

            case "storageSet":
                let key = body["key"] as? String ?? ""
                let value = body["value"] as? String ?? "{}"
                if isSafeIdentifier(key) && value.utf8.count <= 262_144 {
                    UserDefaults.standard.set(validatedJsonString(value), forKey: "pulso_store_" + key)
                }
                resolveEditor(reqId: reqId, jsonValue: "true")

            case "waRequest":
                let what = body["what"] as? String ?? ""
                guard what == "status" || what == "send" else {
                    resolveEditor(reqId: reqId, jsonValue: "{\"ok\":false,\"detail\":\"Ação não permitida.\"}")
                    return
                }
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

    private func isSafeIdentifier(_ value: String) -> Bool {
        guard !value.isEmpty, value.count <= 64 else { return false }
        return value.unicodeScalars.allSatisfy { s in
            (s.value >= 48 && s.value <= 57) ||
            (s.value >= 65 && s.value <= 90) ||
            (s.value >= 97 && s.value <= 122) ||
            s == "_" || s == "-" || s == "."
        }
    }

    private func validatedJsonString(_ raw: String) -> String {
        guard let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
              let safe = try? JSONSerialization.data(withJSONObject: obj, options: [.fragmentsAllowed]),
              let out = String(data: safe, encoding: .utf8) else {
            return "{}"
        }
        return out
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
            if err != nil {
                self?.pendingRequests.removeValue(forKey: msgId)
                let errObj: [String: Any] = ["ok": false, "detail": "WhatsApp Web indisponível no momento."]
                let errJson = (try? JSONSerialization.data(withJSONObject: errObj)).flatMap { String(data: $0, encoding: .utf8) } ?? "{\"ok\":false}"
                self?.resolveEditor(reqId: reqId, jsonValue: errJson)
            }
        }
    }

    private func resolveEditor(reqId: String, jsonValue: String) {
        guard isSafeIdentifier(reqId) else { return }
        let safeJson = validatedJsonString(jsonValue)
        let js = "window.__pulsoNativeResolve && window.__pulsoNativeResolve(\"\(reqId)\", \(safeJson));"
        editorWebView.evaluateJavaScript(js, completionHandler: nil)
    }
}
