import Foundation
import WebKit

/// Serves bundled Pulso web assets (editor.html, editor.js, editor.css, encoder.wasm, icons) over pulso://app/
final class PulsoSchemeHandler: NSObject, WKURLSchemeHandler {
    private let webRoot: URL

    override init() {
        if let url = Bundle.main.url(forResource: "Web", withExtension: nil) {
            self.webRoot = url
        } else {
            self.webRoot = Bundle.main.bundleURL
        }
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "PulsoScheme", code: 400))
            return
        }
        var relPath = url.path
        if relPath.hasPrefix("/") { relPath.removeFirst() }
        if relPath.isEmpty { relPath = "editor.html" }

        let fileURL = webRoot.appendingPathComponent(relPath)
        guard let data = try? Data(contentsOf: fileURL) else {
            let resp = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            urlSchemeTask.didReceive(resp)
            urlSchemeTask.didFinish()
            return
        }

        let mime = Self.mimeType(for: fileURL.pathExtension.lowercased())
        let headers: [String: String] = [
            "Content-Type": mime,
            "Content-Length": "\(data.count)",
            "Access-Control-Allow-Origin": "*"
        ]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private static func mimeType(for ext: String) -> String {
        switch ext {
        case "html": return "text/html; charset=utf-8"
        case "js": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "wasm": return "application/wasm"
        case "png": return "image/png"
        case "svg": return "image/svg+xml"
        case "json": return "application/json"
        default: return "application/octet-stream"
        }
    }
}
