package app.pulso.android

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class MainActivity : AppCompatActivity() {

    private lateinit var tabEditorBtn: Button
    private lateinit var tabWaBtn: Button
    private lateinit var reloadBtn: Button

    private lateinit var editorContainer: FrameLayout
    private lateinit var editorWebView: WebView

    private lateinit var waContainer: FrameLayout
    private lateinit var waWebView: WebView
    private lateinit var webBackBar: LinearLayout
    private lateinit var pairingScrollView: ScrollView
    private lateinit var ddiField: EditText
    private lateinit var phoneField: EditText
    private lateinit var statusLabel: TextView
    private lateinit var codeBox: LinearLayout
    private lateinit var codeValueLabel: TextView

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var filePickerLauncher: ActivityResultLauncher<Intent>

    private val pendingRequests = ConcurrentHashMap<String, (String) -> Unit>()
    private var activeTabIndex = 0
    private var isWhatsAppLoggedIn = false
    private var showingRawWebView = false
    private var detectedPairingCode: String? = null
    private var waMainSource: String = ""

    private val desktopUA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun roundedBg(fillHex: String, radiusDp: Int, strokeHex: String? = null): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(fillHex))
            cornerRadius = dp(radiusDp).toFloat()
            if (strokeHex != null) setStroke(dp(1), Color.parseColor(strokeHex))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        waMainSource = assets.open("web/wa-main.js").bufferedReader(Charsets.UTF_8).use { it.readText() }

        filePickerLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cb = filePathCallback
            filePathCallback = null
            if (cb == null) return@registerForActivityResult
            if (result.resultCode != RESULT_OK || result.data == null) {
                cb.onReceiveValue(null)
                return@registerForActivityResult
            }
            val data = result.data!!
            val uris = mutableListOf<Uri>()
            val clip = data.clipData
            if (clip != null) {
                for (i in 0 until clip.itemCount) {
                    clip.getItemAt(i)?.uri?.let { uris.add(it) }
                }
            } else {
                data.data?.let { uris.add(it) }
            }
            cb.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#191324"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        root.addView(buildTopBar())

        val bodyHost = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        }
        waContainer = buildWhatsAppContainer()
        editorContainer = buildEditorContainer()
        bodyHost.addView(waContainer)
        bodyHost.addView(editorContainer)
        root.addView(bodyHost)

        setContentView(root)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (activeTabIndex == 1 && showingRawWebView) {
                    showingRawWebView = false
                    updateWhatsAppUI()
                    return
                }
                if (activeTabIndex == 1) {
                    showTab(0)
                    return
                }
                if (editorWebView.canGoBack()) {
                    editorWebView.goBack()
                    return
                }
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            }
        })
        showTab(0)
        loadWhatsApp()
    }

    private fun buildTopBar(): LinearLayout {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#211930"))
            setPadding(dp(10), dp(8), dp(10), dp(8))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        tabEditorBtn = Button(this).apply {
            text = "Editor"
            isAllCaps = false
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, dp(38), 1f).apply { rightMargin = dp(6) }
            setOnClickListener { showTab(0) }
        }

        tabWaBtn = Button(this).apply {
            text = "Conectar WhatsApp"
            isAllCaps = false
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, dp(38), 1f).apply { rightMargin = dp(6) }
            setOnClickListener { showTab(1) }
        }

        reloadBtn = Button(this).apply {
            text = "↻"
            textSize = 18f
            setTextColor(Color.WHITE)
            background = roundedBg("#372952", 18)
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(dp(38), dp(38))
            setOnClickListener { reloadWhatsApp() }
        }

        bar.addView(tabEditorBtn)
        bar.addView(tabWaBtn)
        bar.addView(reloadBtn)
        return bar
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildEditorContainer(): FrameLayout {
        val container = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        editorWebView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#181320"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            addJavascriptInterface(EditorJsBridge(), "PulsoAndroid")

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    return assetLoader.shouldInterceptRequest(request.url)
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = filePathCallback
                    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("video/*", "image/*", "audio/*"))
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                    try {
                        filePickerLauncher.launch(Intent.createChooser(intent, "Escolher vídeo ou imagem"))
                    } catch (e: Exception) {
                        this@MainActivity.filePathCallback = null
                        return false
                    }
                    return true
                }
            }
        }

        container.addView(editorWebView)
        editorWebView.loadUrl("https://appassets.androidplatform.net/assets/web/editor.html")
        return container
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildWhatsAppContainer(): FrameLayout {
        val container = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#161121"))
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val webWrapper = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        webBackBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#251C36"))
            setPadding(dp(10), dp(6), dp(10), dp(6))
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        val backBtn = Button(this).apply {
            text = "← Voltar para tela simplificada por número"
            isAllCaps = false
            textSize = 13.5f
            setTextColor(Color.parseColor("#D8BAFF"))
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener {
                showingRawWebView = false
                updateWhatsAppUI()
            }
        }
        webBackBar.addView(backBtn)
        webWrapper.addView(webBackBar)

        waWebView = WebView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            settings.mediaPlaybackRequiresUserGesture = false
            settings.userAgentString = desktopUA
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

            addJavascriptInterface(WaJsBridge(), "PulsoWaAndroid")

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    if (uri.scheme == "whatsapp") {
                        openWhatsAppApp()
                        return true
                    }
                    return false
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    if (url != null && url.contains("web.whatsapp.com")) {
                        injectWaScripts()
                    }
                }
            }
            webChromeClient = WebChromeClient()
        }
        webWrapper.addView(waWebView)
        container.addView(webWrapper)

        // Native Phone Pairing Overlay
        pairingScrollView = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#161121"))
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedBg("#241B33", 20, "#5B447D")
            setPadding(dp(18), dp(18), dp(18), dp(18))
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(dp(14), dp(18), dp(14), dp(24))
            }
        }

        val title = TextView(this).apply {
            text = "Conectar WhatsApp"
            textSize = 21f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        }
        val subtitle = TextView(this).apply {
            text = "Conecte 1 única vez pelo número (sem QR Code e sem outro celular) para enviar figurinhas com som."
            textSize = 13.5f
            setTextColor(Color.parseColor("#C6B6CC"))
            setPadding(0, dp(6), 0, dp(14))
        }

        val phoneRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        ddiField = EditText(this).apply {
            setText("+55")
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            textSize = 16f
            inputType = InputType.TYPE_CLASS_PHONE
            background = roundedBg("#322547", 12, "#6A4E94")
            layoutParams = LinearLayout.LayoutParams(dp(68), dp(48)).apply { rightMargin = dp(8) }
        }
        val prefs = getSharedPreferences("pulso_prefs", Context.MODE_PRIVATE)
        phoneField = EditText(this).apply {
            hint = "DDD + Número (ex: 11999999999)"
            setHintTextColor(Color.parseColor("#8D7D9E"))
            setTextColor(Color.WHITE)
            textSize = 16f
            inputType = InputType.TYPE_CLASS_PHONE
            setPadding(dp(12), 0, dp(12), 0)
            background = roundedBg("#322547", 12, "#6A4E94")
            setText(prefs.getString("last_phone", "") ?: "")
            layoutParams = LinearLayout.LayoutParams(0, dp(48), 1f)
        }
        phoneRow.addView(ddiField)
        phoneRow.addView(phoneField)

        val genBtn = Button(this).apply {
            text = "Gerar código de 8 dígitos"
            isAllCaps = false
            textSize = 15.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = roundedBg("#7542D1", 14)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(48)
            ).apply { topMargin = dp(12) }
            setOnClickListener { generateCodeTapped() }
        }

        statusLabel = TextView(this).apply {
            text = "Carregando conexão com o WhatsApp…"
            textSize = 13f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#D1B8FA"))
            setPadding(0, dp(10), 0, dp(10))
        }

        codeBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedBg("#143829", 16, "#2EC27A")
            setPadding(dp(14), dp(14), dp(14), dp(14))
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        }
        val codeHeader = TextView(this).apply {
            text = "SEU CÓDIGO DE CONEXÃO"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#8EF0BE"))
        }
        codeValueLabel = TextView(this).apply {
            text = "---- ----"
            textSize = 28f
            typeface = Typeface.MONOSPACE
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setPadding(0, dp(6), 0, dp(10))
        }
        val copyOpenBtn = Button(this).apply {
            text = "Copiar código e abrir WhatsApp"
            isAllCaps = false
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = roundedBg("#24AB6B", 12)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(46)
            )
            setOnClickListener { copyCodeAndOpenWhatsApp() }
        }
        val stepsTxt = TextView(this).apply {
            text = "1. Toque acima para copiar e abrir o WhatsApp.\n2. No WhatsApp: ⋮ → Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone.\n3. Cole o código e volte aqui pro Pulso!"
            textSize = 12.5f
            setTextColor(Color.parseColor("#E3F7ED"))
            setPadding(0, dp(10), 0, 0)
        }
        codeBox.addView(codeHeader)
        codeBox.addView(codeValueLabel)
        codeBox.addView(copyOpenBtn)
        codeBox.addView(stepsTxt)

        val toggleWebBtn = Button(this).apply {
            text = "Mostrar WhatsApp Web / QR Code"
            isAllCaps = false
            textSize = 13.5f
            setTextColor(Color.parseColor("#D4C4E6"))
            background = roundedBg("#322547", 12)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(44)
            ).apply { topMargin = dp(6) }
            setOnClickListener {
                showingRawWebView = true
                updateWhatsAppUI()
            }
        }

        card.addView(title)
        card.addView(subtitle)
        card.addView(phoneRow)
        card.addView(genBtn)
        card.addView(statusLabel)
        card.addView(codeBox)
        card.addView(toggleWebBtn)
        pairingScrollView.addView(card)
        container.addView(pairingScrollView)

        updateWhatsAppUI()
        return container
    }

    private fun injectWaScripts() {
        waWebView.evaluateJavascript(waMainSource, null)
        val helper = """
        (function() {
          if (window.__pulsoWaHelperLoaded) return;
          window.__pulsoWaHelperLoaded = true;
          function post(obj) {
            try { window.PulsoWaAndroid.postEvent(JSON.stringify(obj)); } catch (e) {}
          }
          window.addEventListener("message", function(event) {
            var d = event.data;
            if (!d || d.channel !== "pulso-integracao-v1" || d.direction !== "response") return;
            post({ type: "rpc", id: d.id, result: d.result });
          });

          function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
          function isVisible(el) {
            if (!el) return false;
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          }
          function findPhoneInput() {
            var sels = ['input[aria-label*="telefone" i]', 'input[aria-label*="phone" i]', 'input[type="tel"]', 'form input[type="text"]', 'input[value^="+"]'];
            for (var i = 0; i < sels.length; i++) {
              var list = document.querySelectorAll(sels[i]);
              for (var j = 0; j < list.length; j++) if (isVisible(list[j])) return list[j];
            }
            return null;
          }
          function clickPhoneLoginLink() {
            var all = Array.from(document.querySelectorAll('button, a, span[role="button"], div[role="button"], span, div'));
            for (var i = 0; i < all.length; i++) {
              var el = all[i];
              if (!isVisible(el) || (el.children && el.children.length > 2)) continue;
              var txt = (el.innerText || el.textContent || "").trim();
              if (!txt || txt.length > 75) continue;
              if (/n[uú]mero de telefone|phone number|conectar com n[uú]mero|entrar com n[uú]mero|link with phone|log in with phone/i.test(txt)) {
                (el.closest('button, a, [role="button"]') || el).click();
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
              if (/^(avan[cç]ar|next|continuar|prosseguir)$/i.test((b.innerText || b.textContent || "").trim())) return b;
            }
            return null;
          }
          function extractPairingCode() {
            var attrEl = document.querySelector('[data-link-code]');
            if (attrEl) {
              var raw = (attrEl.getAttribute('data-link-code') || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
              if (raw.length === 8) return raw.slice(0, 4) + '-' + raw.slice(4);
            }
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
            try { inp.select(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, value); } catch (e) {}
            try {
              var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
              if (desc && desc.set) desc.set.call(inp, value); else inp.value = value;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {}
          }

          window.__pulsoStartPhonePairing = async function(ddiDigits, localDigits) {
            var fullPlus = '+' + ddiDigits + localDigits;
            post({ type: "pairingStatus", text: "Aguardando WhatsApp Web carregar…" });
            for (var t = 0; t < 45; t++) {
              if (document.querySelector('#pane-side')) { post({ type: "loginState", loggedIn: true }); return; }
              if (findPhoneInput() || extractPairingCode() || document.querySelector('canvas')) break;
              await sleep(300);
            }
            if (extractPairingCode()) { post({ type: "pairingCode", code: extractPairingCode() }); return; }
            var inp = findPhoneInput();
            if (!inp) {
              post({ type: "pairingStatus", text: "Abrindo login por número…" });
              var clicked = false;
              for (var k = 0; k < 20; k++) { if (clickPhoneLoginLink()) { clicked = true; break; } await sleep(350); }
              if (!clicked) { post({ type: "pairingError", text: "Mostrando o WhatsApp Web para você tocar em 'Conectar com número'." }); return; }
              for (var w = 0; w < 25; w++) { inp = findPhoneInput(); if (inp) break; await sleep(300); }
            }
            if (!inp) { post({ type: "pairingError", text: "Digite seu número direto na tela abaixo." }); return; }
            post({ type: "pairingStatus", text: "Preenchendo número e gerando código…" });
            var cur = (inp.value || '').trim();
            fillReactInput(inp, (cur.indexOf('+') === 0 || cur === '') ? fullPlus : localDigits);
            await sleep(450);
            var nextBtn = findNextButton();
            if (!nextBtn) { post({ type: "pairingError", text: "Número preenchido! Toque em Avançar na tela abaixo." }); return; }
            nextBtn.click();
            for (var c = 0; c < 65; c++) {
              if (document.querySelector('#pane-side')) { post({ type: "loginState", loggedIn: true }); return; }
              var code = extractPairingCode();
              if (code) { post({ type: "pairingCode", code: code }); return; }
              await sleep(300);
            }
            post({ type: "pairingError", text: "O WhatsApp demorou para responder. Confira a tela abaixo." });
          };

          var lastLogged = null, lastCode = null, sentReady = false;
          setInterval(function() {
            var logged = !!(document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]'));
            if (!sentReady && (logged || document.querySelector('canvas') || findPhoneInput())) {
              sentReady = true; post({ type: "webReady" });
            }
            if (logged !== lastLogged) { lastLogged = logged; post({ type: "loginState", loggedIn: logged }); }
            var code = logged ? null : extractPairingCode();
            if (code !== lastCode) { lastCode = code; post({ type: "pairingCode", code: code || "" }); }
          }, 1000);
        })();
        """.trimIndent()
        waWebView.evaluateJavascript(helper, null)
    }

    private fun showTab(index: Int) {
        activeTabIndex = index
        val isEditor = (index == 0)
        editorContainer.visibility = if (isEditor) View.VISIBLE else View.GONE
        waContainer.visibility = if (isEditor) View.GONE else View.VISIBLE
        reloadBtn.visibility = if (isEditor) View.GONE else View.VISIBLE
        tabEditorBtn.background = roundedBg(if (isEditor) "#6B3DB8" else "#312447", 10)
        tabWaBtn.background = roundedBg(if (!isEditor) "#6B3DB8" else "#312447", 10)
        if (isEditor) {
            editorWebView.evaluateJavascript("window.__pulsoOnShow && window.__pulsoOnShow()", null)
        } else {
            editorWebView.evaluateJavascript("window.__pulsoOnHide && window.__pulsoOnHide()", null)
        }
    }

    private fun updateWhatsAppUI() {
        if (isWhatsAppLoggedIn) {
            tabWaBtn.text = "WhatsApp conectado"
            pairingScrollView.visibility = View.GONE
            webBackBar.visibility = View.GONE
            return
        }
        tabWaBtn.text = "Conectar WhatsApp"
        pairingScrollView.visibility = if (showingRawWebView) View.GONE else View.VISIBLE
        webBackBar.visibility = if (showingRawWebView) View.VISIBLE else View.GONE

        val code = detectedPairingCode
        if (!code.isNullOrEmpty()) {
            codeBox.visibility = View.VISIBLE
            codeValueLabel.text = code
            statusLabel.text = "Código pronto! Copie e cole no WhatsApp."
            statusLabel.setTextColor(Color.parseColor("#8EF0BE"))
        } else {
            codeBox.visibility = View.GONE
        }
    }

    private fun loadWhatsApp() {
        waWebView.loadUrl("https://web.whatsapp.com/")
    }

    private fun reloadWhatsApp() {
        detectedPairingCode = null
        statusLabel.text = "Recarregando WhatsApp Web…"
        updateWhatsAppUI()
        waWebView.reload()
    }

    private fun generateCodeTapped() {
        val ddi = ddiField.text.toString().filter { it.isDigit() }.ifEmpty { "55" }
        val local = phoneField.text.toString().filter { it.isDigit() }
        if (local.length < 8) {
            statusLabel.text = "Digite o DDD + seu número (ex: 11999999999)."
            statusLabel.setTextColor(Color.parseColor("#FF9EB3"))
            return
        }
        getSharedPreferences("pulso_prefs", Context.MODE_PRIVATE).edit().putString("last_phone", local).apply()
        detectedPairingCode = null
        codeBox.visibility = View.GONE
        statusLabel.setTextColor(Color.parseColor("#D1B8FA"))
        statusLabel.text = "Solicitando código de 8 dígitos…"
        waWebView.evaluateJavascript("window.__pulsoStartPhonePairing && window.__pulsoStartPhonePairing('$ddi', '$local');", null)
    }

    private fun copyCodeAndOpenWhatsApp() {
        val code = detectedPairingCode ?: return
        val clean = code.replace("-", "")
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("WhatsApp Code", clean))
        Toast.makeText(this, "Código $code copiado!", Toast.LENGTH_LONG).show()
        openWhatsAppApp()
    }

    private fun openWhatsAppApp() {
        try {
            val intent = packageManager.getLaunchIntentForPackage("com.whatsapp")
                ?: packageManager.getLaunchIntentForPackage("com.whatsapp.w4b")
                ?: Intent(Intent.ACTION_VIEW, Uri.parse("whatsapp://"))
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "Abra o WhatsApp e cole o código copiado.", Toast.LENGTH_LONG).show()
        }
    }

    private fun forwardToWhatsApp(reqId: String, what: String, payloadObj: Any?) {
        val msgId = UUID.randomUUID().toString().lowercase()
        pendingRequests[msgId] = { json -> resolveEditor(reqId, json) }
        val env = JSONObject().apply {
            put("channel", "pulso-integracao-v1")
            put("direction", "request")
            put("id", msgId)
            put("what", what)
            if (payloadObj != null && payloadObj != JSONObject.NULL) put("payload", payloadObj)
        }
        val js = "window.postMessage(${env}, location.origin);"
        runOnUiThread { waWebView.evaluateJavascript(js, null) }
    }

    private val safeIdRegex = Regex("^[a-zA-Z0-9_.-]{1,64}$")

    private fun isSafeId(v: String): Boolean = safeIdRegex.matches(v)

    private fun safeJsonLiteral(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed == "true" || trimmed == "false" || trimmed == "null") return trimmed
        return try {
            JSONObject(trimmed).toString()
        } catch (_: Exception) {
            "{}"
        }
    }

    private fun resolveEditor(reqId: String, jsonValue: String) {
        if (!isSafeId(reqId)) return
        val safeVal = safeJsonLiteral(jsonValue)
        val js = "window.__pulsoNativeResolve && window.__pulsoNativeResolve(${JSONObject.quote(reqId)}, $safeVal);"
        runOnUiThread { editorWebView.evaluateJavascript(js, null) }
    }

    inner class EditorJsBridge {
        @JavascriptInterface
        fun postMessage(rawJson: String) {
            try {
                val obj = JSONObject(rawJson)
                val action = obj.optString("action")
                val reqId = obj.optString("id")
                val prefs = getSharedPreferences("pulso_store", Context.MODE_PRIVATE)
                when (action) {
                    "close", "openWhatsAppTab" -> {
                        runOnUiThread { showTab(1) }
                        if (reqId.isNotEmpty()) resolveEditor(reqId, "true")
                    }
                    "storageGet" -> {
                        val key = obj.optString("key")
                        if (!isSafeId(key)) {
                            resolveEditor(reqId, "{}")
                            return
                        }
                        val saved = prefs.getString("k_$key", "{}") ?: "{}"
                        resolveEditor(reqId, saved)
                    }
                    "storageSet" -> {
                        val key = obj.optString("key")
                        val value = obj.optString("value", "{}")
                        if (isSafeId(key) && value.length <= 262_144) {
                            prefs.edit().putString("k_$key", safeJsonLiteral(value)).apply()
                        }
                        resolveEditor(reqId, "true")
                    }
                    "waRequest" -> {
                        val what = obj.optString("what")
                        if (what != "status" && what != "send") {
                            resolveEditor(reqId, "{\"ok\":false,\"detail\":\"Ação não permitida.\"}")
                            return
                        }
                        val payload = obj.opt("payload")
                        forwardToWhatsApp(reqId, what, payload)
                    }
                }
            } catch (_: Exception) {}
        }
    }

    inner class WaJsBridge {
        @JavascriptInterface
        fun postEvent(rawJson: String) {
            try {
                val obj = JSONObject(rawJson)
                when (obj.optString("type", "rpc")) {
                    "webReady" -> runOnUiThread {
                        if (!isWhatsAppLoggedIn && detectedPairingCode == null) {
                            statusLabel.text = "Pronto! Digite seu DDD + número e toque em Gerar Código."
                        }
                    }
                    "pairingStatus" -> {
                        val txt = obj.optString("text")
                        runOnUiThread {
                            statusLabel.text = txt
                            statusLabel.setTextColor(Color.parseColor("#D1B8FA"))
                        }
                    }
                    "pairingError" -> {
                        val txt = obj.optString("text")
                        runOnUiThread {
                            statusLabel.text = txt
                            statusLabel.setTextColor(Color.parseColor("#FF9EB3"))
                            showingRawWebView = true
                            updateWhatsAppUI()
                        }
                    }
                    "pairingCode" -> {
                        val code = obj.optString("code")
                        runOnUiThread {
                            detectedPairingCode = code.ifEmpty { null }
                            if (code.isNotEmpty()) showingRawWebView = false
                            updateWhatsAppUI()
                        }
                    }
                    "loginState" -> {
                        val logged = obj.optBoolean("loggedIn", false)
                        runOnUiThread {
                            val became = (!isWhatsAppLoggedIn && logged)
                            isWhatsAppLoggedIn = logged
                            if (logged) {
                                detectedPairingCode = null
                                showingRawWebView = false
                            }
                            updateWhatsAppUI()
                            if (became) {
                                showTab(0)
                                Toast.makeText(this@MainActivity, "WhatsApp conectado.", Toast.LENGTH_LONG).show()
                            }
                        }
                    }
                    "rpc" -> {
                        val id = obj.optString("id")
                        val cb = pendingRequests.remove(id)
                        if (cb != null) {
                            val res = obj.opt("result")?.toString() ?: "{\"ok\":false}"
                            cb(res)
                        }
                    }
                }
            } catch (_: Exception) {}
        }
    }
}
