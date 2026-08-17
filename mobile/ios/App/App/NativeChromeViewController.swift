import UIKit
import WebKit
import Capacitor

/// Bridge-VC mit nativem "Liquid Glass"-Chrome (iOS 26 UIGlassEffect) über dem
/// WebView: Menü-Button links, ViewSwitcher-Pille (Chat/Mail/Kalender) rechts.
/// Die Web-App erkennt das native Chrome (html[data-native-chrome]) und blendet
/// ihre CSS-Variante aus; Kommunikation:
///   Web  -> Nativ: window.webkit.messageHandlers.nativeChrome.postMessage({hidden, active})
///   Nativ -> Web:  window.__nativeNavigate('chat'|'mail'|'calendar') / window.__nativeOpenDrawer()
/// iOS < 26 fällt auf UIBlurEffect zurück. Nur iPhone-Breiten (Web zeigt ihr
/// Chrome ohnehin nur < 1024 px — auf dem iPad bleibt alles wie bisher web).
class NativeChromeViewController: CAPBridgeViewController, WKScriptMessageHandler {

    private var chromeContainer = UIView()
    private var menuEffectView: UIVisualEffectView!
    private var pillEffectView: UIVisualEffectView!
    private var tabButtons: [UIButton] = []
    private var scrimView = UIView()
    private var scrimLayer = CAGradientLayer()
    private var chromeHiddenByWeb = false
    private var chromeHiddenByKeyboard = false

    private let tabs: [(id: String, symbol: String)] = [
        ("chat", "message"),
        ("mail", "envelope"),
        ("calendar", "calendar"),
    ]
    private let accent = UIColor(red: 166 / 255, green: 218 / 255, blue: 255 / 255, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let webView = self.webView else { return }

        // Web-App informieren, dass natives Chrome übernimmt (überlebt Reloads)
        let flagScript = WKUserScript(
            source: "document.documentElement.dataset.nativeChrome = '1'",
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        webView.configuration.userContentController.addUserScript(flagScript)
        webView.configuration.userContentController.add(self, name: "nativeChrome")

        setupChrome()

        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillShow), name: UIResponder.keyboardWillShowNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillHide), name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    // MARK: - Chrome-Aufbau

    private func makeGlassView(cornerRadius: CGFloat) -> UIVisualEffectView {
        let effectView: UIVisualEffectView
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect()
            glass.isInteractive = true
            effectView = UIVisualEffectView(effect: glass)
        } else {
            effectView = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        }
        effectView.layer.cornerRadius = cornerRadius
        effectView.clipsToBounds = true
        effectView.translatesAutoresizingMaskIntoConstraints = false
        return effectView
    }

    private func setupChrome() {
        // Status-Leisten-Scrim (das Web-Chrome samt Scrim ist ausgeblendet)
        scrimLayer.colors = [
            UIColor(red: 4 / 255, green: 7 / 255, blue: 13 / 255, alpha: 0.85).cgColor,
            UIColor(red: 4 / 255, green: 7 / 255, blue: 13 / 255, alpha: 0.0).cgColor,
        ]
        scrimView.isUserInteractionEnabled = false
        scrimView.translatesAutoresizingMaskIntoConstraints = false
        scrimView.layer.addSublayer(scrimLayer)
        view.addSubview(scrimView)

        chromeContainer.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(chromeContainer)

        // Menü-Button (Kreis, 44 pt)
        menuEffectView = makeGlassView(cornerRadius: 22)
        let menuButton = UIButton(type: .system)
        menuButton.setImage(
            UIImage(systemName: "line.3.horizontal", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .medium)),
            for: .normal)
        menuButton.tintColor = UIColor(white: 1, alpha: 0.92)
        menuButton.translatesAutoresizingMaskIntoConstraints = false
        menuButton.addTarget(self, action: #selector(menuTapped), for: .touchUpInside)
        menuEffectView.contentView.addSubview(menuButton)
        chromeContainer.addSubview(menuEffectView)

        // ViewSwitcher-Pille (3 Tabs)
        pillEffectView = makeGlassView(cornerRadius: 22)
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.translatesAutoresizingMaskIntoConstraints = false
        for (index, tab) in tabs.enumerated() {
            let button = UIButton(type: .system)
            button.setImage(
                UIImage(systemName: tab.symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)),
                for: .normal)
            button.tintColor = UIColor(white: 1, alpha: 0.6)
            button.tag = index
            button.addTarget(self, action: #selector(tabTapped(_:)), for: .touchUpInside)
            tabButtons.append(button)
            stack.addArrangedSubview(button)
        }
        pillEffectView.contentView.addSubview(stack)
        chromeContainer.addSubview(pillEffectView)

        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            scrimView.topAnchor.constraint(equalTo: view.topAnchor),
            scrimView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrimView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrimView.bottomAnchor.constraint(equalTo: safe.topAnchor, constant: 72),

            chromeContainer.topAnchor.constraint(equalTo: safe.topAnchor, constant: 4),
            chromeContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            chromeContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            chromeContainer.heightAnchor.constraint(equalToConstant: 44),

            menuEffectView.leadingAnchor.constraint(equalTo: chromeContainer.leadingAnchor),
            menuEffectView.centerYAnchor.constraint(equalTo: chromeContainer.centerYAnchor),
            menuEffectView.widthAnchor.constraint(equalToConstant: 44),
            menuEffectView.heightAnchor.constraint(equalToConstant: 44),

            menuButton.topAnchor.constraint(equalTo: menuEffectView.contentView.topAnchor),
            menuButton.bottomAnchor.constraint(equalTo: menuEffectView.contentView.bottomAnchor),
            menuButton.leadingAnchor.constraint(equalTo: menuEffectView.contentView.leadingAnchor),
            menuButton.trailingAnchor.constraint(equalTo: menuEffectView.contentView.trailingAnchor),

            pillEffectView.trailingAnchor.constraint(equalTo: chromeContainer.trailingAnchor),
            pillEffectView.centerYAnchor.constraint(equalTo: chromeContainer.centerYAnchor),
            pillEffectView.widthAnchor.constraint(equalToConstant: 3 * 46 + 8),
            pillEffectView.heightAnchor.constraint(equalToConstant: 44),

            stack.topAnchor.constraint(equalTo: pillEffectView.contentView.topAnchor),
            stack.bottomAnchor.constraint(equalTo: pillEffectView.contentView.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: pillEffectView.contentView.leadingAnchor, constant: 4),
            stack.trailingAnchor.constraint(equalTo: pillEffectView.contentView.trailingAnchor, constant: -4),
        ])

        // iPad / breite Fenster: Web-Chrome übernimmt (>= 1024 px zeigt eh Desktop-UI)
        chromeContainer.isHidden = view.bounds.width >= 1024
        scrimView.isHidden = chromeContainer.isHidden
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        scrimLayer.frame = scrimView.bounds
        chromeContainer.isHidden = view.bounds.width >= 1024
        scrimView.isHidden = chromeContainer.isHidden
    }

    // MARK: - Aktionen (Nativ -> Web)

    private func runJS(_ js: String) {
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    @objc private func menuTapped() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        runJS("window.__nativeOpenDrawer && window.__nativeOpenDrawer()")
    }

    @objc private func tabTapped(_ sender: UIButton) {
        UISelectionFeedbackGenerator().selectionChanged()
        let tab = tabs[sender.tag]
        runJS("window.__nativeNavigate && window.__nativeNavigate('\(tab.id)')")
    }

    // MARK: - Web -> Nativ

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeChrome", let body = message.body as? [String: Any] else { return }
        if let hidden = body["hidden"] as? Bool {
            chromeHiddenByWeb = hidden
            applyChromeVisibility()
        }
        if let active = body["active"] as? String {
            for (index, tab) in tabs.enumerated() {
                tabButtons[index].tintColor = tab.id == active ? accent : UIColor(white: 1, alpha: 0.6)
            }
        }
    }

    // MARK: - Tastatur

    @objc private func keyboardWillShow() {
        chromeHiddenByKeyboard = true
        applyChromeVisibility()
    }

    @objc private func keyboardWillHide() {
        chromeHiddenByKeyboard = false
        applyChromeVisibility()
    }

    private func applyChromeVisibility() {
        let hidden = chromeHiddenByWeb || chromeHiddenByKeyboard
        UIView.animate(withDuration: 0.24, delay: 0, options: [.curveEaseOut]) {
            self.chromeContainer.alpha = hidden ? 0 : 1
            self.chromeContainer.transform = hidden ? CGAffineTransform(translationX: 0, y: -10) : .identity
        }
        chromeContainer.isUserInteractionEnabled = !hidden
    }
}
