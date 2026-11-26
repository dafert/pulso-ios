import UIKit
import WebKit

final class WhatsAppViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {
    private var waWebView: WKWebView!
    private var editorWebView: WKWebView!
    private var editorContainer: UIView!
    private var launcherButton: UIButton!
    private var reloadButton: UIButton!
    private var pendingRequests: [String: (String) -> Void] = [:]

    private let desktopUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.07, green: 0.11, blue: 0.13, alpha: 1)
        setupWhatsAppWebView()
        setupEditorOverlay()
        setupLauncherButton()
        loadWhatsApp()
    }

    private func setupWhatsAppWebView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.preferredContentMode = .desktop
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let ucc = WKUserContentController()
        ucc.add(self, name: "waBridge")

        // Inject wa-main.js + response listener forwarding to native bridge
        if let waMainURL = Bundle.main.url(forResource: "wa-main", withExtension: "js", subdirectory: "Web"),
           let waMainSrc = try? String(contentsOf: waMainURL, encoding: .utf8) {
            ucc.addUserScript(WKUserScript(source: waMainSrc, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }

        let waResponseHook = """
        window.addEventListener("message", function(event) {
          var d = event.data;
          if (!d || d.channel !== "pulso-integracao-v1" || d.direction !== "response") return;
          try {
            window.webkit.messageHandlers.waBridge.postMessage({ id: d.id, result: d.result });
          } catch (e) {}
        });
        """
        ucc.addUserScript(WKUserScript(source: waResponseHook, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController = ucc

        waWebView = WKWebView(frame: .zero, configuration: config)
        waWebView.translatesAutoresizingMaskIntoConstraints = false
        waWebView.customUserAgent = desktopUA
        waWebView.navigationDelegate = self
        waWebView.allowsBackForwardNavigationGestures = true
        view.addSubview(waWebView)

        NSLayoutConstraint.activate([
            waWebView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            waWebView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            waWebView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            waWebView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func setupEditorOverlay() {
        editorContainer = UIView()
        editorContainer.translatesAutoresizingMaskIntoConstraints = false
        editorContainer.backgroundColor = UIColor(red: 0.13, green: 0.10, blue: 0.16, alpha: 1)
        editorContainer.layer.cornerRadius = 18
        editorContainer.layer.masksToBounds = true
        editorContainer.layer.borderWidth = 1
        editorContainer.layer.borderColor = UIColor(red: 0.61, green: 0.51, blue: 0.73, alpha: 0.6).cgColor
        editorContainer.isHidden = true
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
        editorContainer.addSubview(editorWebView)

        NSLayoutConstraint.activate([
            editorContainer.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 10),
            editorContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            editorContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            editorContainer.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -66),

            editorWebView.topAnchor.constraint(equalTo: editorContainer.topAnchor),
            editorWebView.leadingAnchor.constraint(equalTo: editorContainer.leadingAnchor),
            editorWebView.trailingAnchor.constraint(equalTo: editorContainer.trailingAnchor),
            editorWebView.bottomAnchor.constraint(equalTo: editorContainer.bottomAnchor)
        ])

        if let url = URL(string: "pulso://app/editor.html") {
            editorWebView.load(URLRequest(url: url))
        }
    }

    private func setupLauncherButton() {
        launcherButton = UIButton(type: .system)
        launcherButton.translatesAutoresizingMaskIntoConstraints = false
        launcherButton.setTitle("⚡ Pulso", for: .normal)
        launcherButton.setTitleColor(.white, for: .normal)
        launcherButton.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
        launcherButton.backgroundColor = UIColor(red: 0.38, green: 0.22, blue: 0.64, alpha: 1)
        launcherButton.layer.cornerRadius = 22
        launcherButton.layer.shadowColor = UIColor.black.cgColor
        launcherButton.layer.shadowOpacity = 0.35
        launcherButton.layer.shadowRadius = 8
        launcherButton.layer.shadowOffset = CGSize(width: 0, height: 3)
        launcherButton.contentEdgeInsets = UIEdgeInsets(top: 10, left: 16, bottom: 10, right: 16)
        launcherButton.addTarget(self, action: #selector(toggleEditor), for: .touchUpInside)
        view.addSubview(launcherButton)

        reloadButton = UIButton(type: .system)
        reloadButton.translatesAutoresizingMaskIntoConstraints = false
        reloadButton.setTitle("↻", for: .normal)
        reloadButton.setTitleColor(.white, for: .normal)
        reloadButton.titleLabel?.font = UIFont.systemFont(ofSize: 19, weight: .bold)
        reloadButton.backgroundColor = UIColor(red: 0.22, green: 0.16, blue: 0.34, alpha: 0.92)
        reloadButton.layer.cornerRadius = 22
        reloadButton.layer.shadowColor = UIColor.black.cgColor
        reloadButton.layer.shadowOpacity = 0.3
        reloadButton.layer.shadowRadius = 6
        reloadButton.layer.shadowOffset = CGSize(width: 0, height: 2)
        reloadButton.addTarget(self, action: #selector(reloadWhatsApp), for: .touchUpInside)
        view.addSubview(reloadButton)

        NSLayoutConstraint.activate([
            launcherButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -14),
            launcherButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            launcherButton.heightAnchor.constraint(equalToConstant: 44),

            reloadButton.trailingAnchor.constraint(equalTo: launcherButton.leadingAnchor, constant: -8),
            reloadButton.bottomAnchor.constraint(equalTo: launcherButton.bottomAnchor),
            reloadButton.widthAnchor.constraint(equalToConstant: 44),
            reloadButton.heightAnchor.constraint(equalToConstant: 44)
        ])
    }

    @objc private func reloadWhatsApp() {
        waWebView.reload()
    }

    @objc private func toggleEditor() {
        let show = editorContainer.isHidden
        editorContainer.isHidden = !show
        launcherButton.setTitle(show ? "✕ Fechar" : "⚡ Pulso", for: .normal)
        if show {
            editorWebView.evaluateJavaScript("window.__pulsoOnShow && window.__pulsoOnShow()", completionHandler: nil)
        } else {
            editorWebView.evaluateJavaScript("window.__pulsoOnHide && window.__pulsoOnHide()", completionHandler: nil)
        }
    }

    private func loadWhatsApp() {
        if let url = URL(string: "https://web.whatsapp.com/") {
            waWebView.load(URLRequest(url: url))
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        preferences.preferredContentMode = .desktop
        decisionHandler(.allow, preferences)
    }

    // MARK: - WKScriptMessageHandler
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }

        if message.name == "waBridge" {
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
                DispatchQueue.main.async {
                    if !self.editorContainer.isHidden { self.toggleEditor() }
                }

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
