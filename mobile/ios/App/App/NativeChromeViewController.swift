import UIKit
import WebKit
import Capacitor

/// Bridge-VC mit nativem Liquid-Glass-Chrome (iOS 26 `UIGlassEffect`) über dem
/// WebView. Standard-Layout: Menü-Button links oben, ViewSwitcher-Pille
/// (Chat/Mail/Kalender) rechts oben — beides echte Glasformen in EINEM
/// `UIGlassContainerEffect`, bewusst ohne `clipsToBounds`: Glas rendert
/// Lichtkante, Randbrechung und Schatten über die eigenen Bounds hinaus; ein
/// Hart-Clip schneidet genau die Schichten weg, die aus einem Blur erst Liquid
/// Glass machen (Stand 1.0.3 — übrig blieb eine matte Pille).
///
/// Optional (von der Web-App per `glass.useSystemTabBar` schaltbar): Apples
/// ECHTE Tab-Bar (`UITabBarController`) unten statt der Pille oben. Das ist
/// dieselbe Leiste wie in WhatsApp/Reddit — samt Auswahl-Morph, der dem
/// System gehört.
///
/// Kontrakt (kompatibel zu Web-Ständen seit 1.0.3):
///   Nativ -> Web: html[data-native-chrome="1"] (Web blendet ihr Chrome aus),
///                 window.__nativeNavigate('chat'|'mail'|'calendar'),
///                 window.__nativeOpenDrawer(),
///                 --native-tabbar-h + html[data-native-tabbar] (nur System-Leiste)
///   Web  -> Nativ: webkit.messageHandlers.nativeChrome.postMessage(
///                 {hidden?, active?, theme?, accent?, glass?})
/// Das Chrome bleibt unsichtbar, bis die erste Web-Meldung eintrifft — Login-
/// Seite und alte Web-Stände ohne Bridge zeigen so nichts Natives.
/// iOS < 26 fällt auf `UIBlurEffect` zurück. Ab 1024 pt Breite (iPad, Desktop-
/// Layout der Web-App) übernimmt das Web-Chrome.
class NativeChromeViewController: CAPBridgeViewController, WKScriptMessageHandler, UITabBarControllerDelegate {

    // MARK: - Stellschrauben (alle von der Web-App überschreibbar)

    /// Nativer Code steckt im Binary und braucht für jede Korrektur einen
    /// App-Store-Durchlauf. Die Web-App ist in Sekunden deployt — was hier als
    /// Parameter steht, lässt sich darum ohne Apple nachjustieren (Feld
    /// `glass` der nativeChrome-Meldung; `src/components/mobile/NativeChromeBridge.tsx`).
    /// Die Defaults sind der ausgelieferte Stand.
    private struct GlassConfig: Equatable {
        var clearStyle = false          // .clear statt .regular → viel durchsichtiger
        var interactive = true          // Glas reagiert auf Berührung
        var spacing: CGFloat = 40       // Abstand, ab dem Glasformen verschmelzen
        var tintAlpha: CGFloat = 0.22   // Akzent im Auswahl-Lozenge; < 0.02 = neutrales Glas
        var tintHex: String?            // Lozenge-Farbe, nil = Web-Akzent
        var activeHex: String?          // Icon des aktiven Tabs, nil = Web-Akzent
        var scrimHex: String?           // Status-Leisten-Scrim, nil = Theme-Farbe
        var scrimAlpha: CGFloat = 0.82  // 0 = kein Scrim
        var lozengeInsetX: CGFloat = 3
        var lozengeInsetY: CGFloat = 4
        var switchStyle = "flow"        // "flow" | "fade" | "slide"
        var switchDuration: Double = 0.42
        var switchDamping: CGFloat = 0.72
        var iconSize: CGFloat = 17
        var iconFilledWhenActive = true
        var controlHeight: CGFloat = 44 // Menü-Kreis und Pille
        var tabWidth: CGFloat = 50
        var sideMargin: CGFloat = 12
        var topInset: CGFloat = 4
        var useSystemTabBar = false     // Apples Leiste unten statt Pille oben
        var labelSize: CGFloat = 10.5   // nur System-Leiste
    }
    private var glassConfig = GlassConfig()

    // MARK: - State

    private var chromeContainer: ChromeContainerView!
    private var menuPiece: UIVisualEffectView!
    private var menuButton: UIButton!
    private var pillPiece: UIVisualEffectView!
    private var tabStack: UIStackView!
    private var tabButtons: [UIButton] = []
    private var indicatorView: UIView!
    private var scrimView = UIView()
    private var scrimLayer = CAGradientLayer()

    private var systemTabController: UITabBarController?
    private var tabOverlay: PassthroughView?
    private var syncingSystemSelection = false
    private var reportedBottomInset: CGFloat = -1

    private var chromeReady = false
    private var hiddenByWeb = false
    private var hiddenByKeyboard = false
    private var lastAppliedHidden: Bool?
    private var isLightTheme = false
    private var accent = UIColor(red: 166 / 255, green: 218 / 255, blue: 255 / 255, alpha: 1)
    private var activeTabId = ""
    private var currentActiveIndex: Int?

    private var containerTop: NSLayoutConstraint?
    private var containerLeading: NSLayoutConstraint?
    private var containerTrailing: NSLayoutConstraint?
    private var containerHeight: NSLayoutConstraint?
    private var menuWidth: NSLayoutConstraint?
    private var pillWidth: NSLayoutConstraint?

    private var lozengeColor: UIColor {
        glassConfig.tintHex.flatMap { Self.color(fromHex: $0) } ?? accent
    }
    private var activeColor: UIColor {
        glassConfig.activeHex.flatMap { Self.color(fromHex: $0) } ?? accent
    }
    private var scrimColor: UIColor {
        if let hex = glassConfig.scrimHex, let color = Self.color(fromHex: hex) { return color }
        return isLightTheme
            ? UIColor(red: 233 / 255, green: 237 / 255, blue: 246 / 255, alpha: 1)
            : UIColor(red: 4 / 255, green: 7 / 255, blue: 13 / 255, alpha: 1)
    }

    /// IDs = Routen der Web-App, Symbole spiegeln ihren ViewSwitcher.
    private let tabs: [(id: String, symbol: String, label: String)] = [
        ("chat", "message", "Chat"),
        ("mail", "envelope", "Mail"),
        ("calendar", "calendar", "Kalender"),
    ]

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let webView = self.webView else { return }

        // Web-App informieren, dass natives Chrome verfügbar ist (überlebt
        // Reloads), und den Rückkanal registrieren.
        let flagScript = WKUserScript(
            source: "document.documentElement.dataset.nativeChrome = '1'",
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        webView.configuration.userContentController.addUserScript(flagScript)
        webView.configuration.userContentController.add(self, name: "nativeChrome")

        setupChrome()
        applyTheme()

        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillShow), name: UIResponder.keyboardWillShowNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillHide), name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        scrimLayer.frame = scrimView.bounds
        applyChromeVisibility()
        layoutIndicator(animated: false)
        reportBottomInset()
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            self?.applyChromeVisibility()
            self?.layoutIndicator(animated: false)
        }
    }

    // MARK: - Glas-Bausteine

    @available(iOS 26.0, *)
    private func containerEffect() -> UIGlassContainerEffect {
        let container = UIGlassContainerEffect()
        container.spacing = glassConfig.spacing
        return container
    }

    @available(iOS 26.0, *)
    private func glassEffect(tinted: Bool) -> UIGlassEffect {
        let glass = glassConfig.clearStyle
            ? UIGlassEffect(style: .clear)
            : UIGlassEffect(style: .regular)
        glass.isInteractive = glassConfig.interactive
        if tinted, glassConfig.tintAlpha >= 0.02 {
            glass.tintColor = lozengeColor.withAlphaComponent(glassConfig.tintAlpha)
        }
        return glass
    }

    /// Eine Glasform. iOS 26: `cornerConfiguration` formt das Glas, kein
    /// Clip. <26: Blur-Kapsel mit Layer-Radius (dort gibt es nichts, was ein
    /// Clip wegschneiden könnte).
    private func makeGlassPiece(tinted: Bool, cornerRadius: CGFloat) -> UIVisualEffectView {
        let effectView: UIVisualEffectView
        if #available(iOS 26.0, *) {
            effectView = UIVisualEffectView(effect: glassEffect(tinted: tinted))
            effectView.cornerConfiguration = .capsule()
        } else {
            effectView = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
            effectView.layer.cornerRadius = cornerRadius
            effectView.layer.cornerCurve = .continuous
            effectView.clipsToBounds = true
        }
        effectView.translatesAutoresizingMaskIntoConstraints = false
        return effectView
    }

    private func setupChrome() {
        // Scrim hinter der Status-Leiste — das Web-Chrome samt Scrim ist aus.
        scrimView.isUserInteractionEnabled = false
        scrimView.translatesAutoresizingMaskIntoConstraints = false
        scrimView.layer.addSublayer(scrimLayer)
        view.addSubview(scrimView)

        // Gemeinsamer Glas-Container: zeichnet selbst nichts, lässt aber
        // Menü, Pille und Lozenge als EINE Flüssigkeit rendern.
        if #available(iOS 26.0, *) {
            chromeContainer = ChromeContainerView(effect: containerEffect())
        } else {
            chromeContainer = ChromeContainerView(effect: nil)
        }
        chromeContainer.translatesAutoresizingMaskIntoConstraints = false
        chromeContainer.alpha = 0
        chromeContainer.isUserInteractionEnabled = false
        view.addSubview(chromeContainer)
        let content = chromeContainer.contentView

        // Menü-Button (Kreis). iOS 26: Apples eigener Glas-Button
        // (`UIButton.Configuration.glass()`) — dieselbe Klasse Glas wie die
        // System-Leiste, inklusive Interaktion. Der umgebende Träger bleibt
        // dann ohne Effekt, sonst läge Glas auf Glas. <26: Blur-Kreis.
        var menuConfig: UIButton.Configuration
        if #available(iOS 26.0, *) {
            menuPiece = UIVisualEffectView(effect: nil)
            menuPiece.translatesAutoresizingMaskIntoConstraints = false
            menuConfig = UIButton.Configuration.glass()
            menuConfig.cornerStyle = .capsule
        } else {
            menuPiece = makeGlassPiece(tinted: false, cornerRadius: glassConfig.controlHeight / 2)
            menuConfig = UIButton.Configuration.plain()
        }
        content.addSubview(menuPiece)
        menuConfig.image = UIImage(
            systemName: "line.3.horizontal",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: glassConfig.iconSize, weight: .medium))
        menuConfig.baseForegroundColor = .label
        menuConfig.contentInsets = .zero
        menuButton = UIButton(configuration: menuConfig)
        menuButton.translatesAutoresizingMaskIntoConstraints = false
        menuButton.accessibilityLabel = "Menü öffnen"
        menuButton.addTarget(self, action: #selector(menuTapped), for: .touchUpInside)
        menuPiece.contentView.addSubview(menuButton)

        // ViewSwitcher-Pille: Glasform + Lozenge + Buttons als Geschwister im
        // Container (Lozenge VOR dem Stack → liegt hinter den Buttons).
        pillPiece = makeGlassPiece(tinted: false, cornerRadius: glassConfig.controlHeight / 2)
        content.addSubview(pillPiece)
        indicatorView = makeIndicatorView()
        content.addSubview(indicatorView)

        let stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.translatesAutoresizingMaskIntoConstraints = false
        for (index, tab) in tabs.enumerated() {
            var config = UIButton.Configuration.plain()
            config.image = symbolImage(tab.symbol, active: false)
            config.contentInsets = .zero
            config.baseForegroundColor = .secondaryLabel
            let button = UIButton(configuration: config)
            button.tag = index
            button.accessibilityLabel = tab.label
            button.addTarget(self, action: #selector(tabTapped(_:)), for: .touchUpInside)
            tabButtons.append(button)
            stack.addArrangedSubview(button)
        }
        tabStack = stack
        content.addSubview(stack)

        // Der Button-Stack ist ein GESCHWISTER der Pille (gleicher Glas-Container),
        // kein Kind — er muss eigens als interaktiv gelten, sonst fallen Taps auf
        // die Tab-Icons durch zur WebView (Befund TestFlight Build 24).
        chromeContainer.interactiveViews = [menuPiece!, pillPiece!, tabStack!]

        let safe = view.safeAreaLayoutGuide
        let top = chromeContainer.topAnchor.constraint(equalTo: safe.topAnchor, constant: glassConfig.topInset)
        let leading = chromeContainer.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: glassConfig.sideMargin)
        let trailing = chromeContainer.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -glassConfig.sideMargin)
        let height = chromeContainer.heightAnchor.constraint(equalToConstant: glassConfig.controlHeight)
        let menuW = menuPiece.widthAnchor.constraint(equalToConstant: glassConfig.controlHeight)
        let pillW = pillPiece.widthAnchor.constraint(equalToConstant: pillWidthValue())
        containerTop = top
        containerLeading = leading
        containerTrailing = trailing
        containerHeight = height
        menuWidth = menuW
        pillWidth = pillW

        NSLayoutConstraint.activate([
            scrimView.topAnchor.constraint(equalTo: view.topAnchor),
            scrimView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrimView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrimView.bottomAnchor.constraint(equalTo: safe.topAnchor, constant: 72),

            top, leading, trailing, height,

            menuPiece.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            menuPiece.topAnchor.constraint(equalTo: content.topAnchor),
            menuPiece.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            menuW,
            menuButton.topAnchor.constraint(equalTo: menuPiece.contentView.topAnchor),
            menuButton.bottomAnchor.constraint(equalTo: menuPiece.contentView.bottomAnchor),
            menuButton.leadingAnchor.constraint(equalTo: menuPiece.contentView.leadingAnchor),
            menuButton.trailingAnchor.constraint(equalTo: menuPiece.contentView.trailingAnchor),

            pillPiece.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            pillPiece.topAnchor.constraint(equalTo: content.topAnchor),
            pillPiece.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            pillW,
            stack.topAnchor.constraint(equalTo: pillPiece.topAnchor),
            stack.bottomAnchor.constraint(equalTo: pillPiece.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: pillPiece.leadingAnchor, constant: 4),
            stack.trailingAnchor.constraint(equalTo: pillPiece.trailingAnchor, constant: -4),
        ])
    }

    private func pillWidthValue() -> CGFloat {
        CGFloat(tabs.count) * glassConfig.tabWidth + 8
    }

    private func makeIndicatorView() -> UIView {
        let view: UIView
        if #available(iOS 26.0, *) {
            // Eigene Glasform im selben Container wie die Pille: beim Wandern
            // fliesst sie in die Pille hinein statt als zweiter Blur darauf zu
            // liegen — der Unterschied zu „Glas auf Glas“.
            view = makeGlassPiece(tinted: true, cornerRadius: 0)
            view.translatesAutoresizingMaskIntoConstraints = true
        } else {
            let plain = UIView()
            plain.layer.cornerCurve = .continuous
            plain.layer.borderWidth = 1
            view = plain
        }
        view.isUserInteractionEnabled = false
        view.alpha = 0
        return view
    }

    /// Übernimmt eine frisch gemeldete Config auf das gebaute Chrome. Effekte
    /// werden getauscht statt Views neu gebaut — animierbar und der von UIKit
    /// vorgesehene Weg.
    private func applyGlassConfig() {
        guard chromeContainer != nil else { return }
        if #available(iOS 26.0, *) {
            let container = containerEffect()
            let plain = glassEffect(tinted: false)
            UIView.animate(withDuration: 0.25) {
                self.chromeContainer.effect = container
                self.pillPiece.effect = plain
                // menuPiece bleibt ohne Effekt — das Glas trägt der Button selbst.
            }
        } else {
            menuPiece.layer.cornerRadius = glassConfig.controlHeight / 2
            pillPiece.layer.cornerRadius = glassConfig.controlHeight / 2
        }
        containerTop?.constant = glassConfig.topInset
        containerLeading?.constant = glassConfig.sideMargin
        containerTrailing?.constant = -glassConfig.sideMargin
        containerHeight?.constant = glassConfig.controlHeight
        menuWidth?.constant = glassConfig.controlHeight
        pillWidth?.constant = pillWidthValue()
        var menuConfig = menuButton.configuration
        menuConfig?.image = UIImage(
            systemName: "line.3.horizontal",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: glassConfig.iconSize, weight: .medium))
        menuButton.configuration = menuConfig

        if glassConfig.useSystemTabBar {
            if #available(iOS 26.0, *) { enableSystemTabBar() }
        } else {
            disableSystemTabBar()
        }
        applySystemTabAppearance()
        applyScrim()
        UIView.animate(withDuration: 0.25) { self.view.layoutIfNeeded() }
        updateIndicatorTint()
        applyActiveTab(animated: false)
    }

    // MARK: - Theme

    private func applyTheme() {
        let style: UIUserInterfaceStyle = isLightTheme ? .light : .dark
        chromeContainer?.overrideUserInterfaceStyle = style
        systemTabController?.overrideUserInterfaceStyle = style
        // Status-Leiste folgt dem Web-Theme (Info.plist: VC-basiert).
        statusBarStyle = isLightTheme ? .darkContent : .lightContent
        setNeedsStatusBarAppearanceUpdate()
        applyScrim()
        // Blur-Fallback: neutrales Material passt sich per Style an.
        if #unavailable(iOS 26.0) {
            let blur = UIBlurEffect(style: .systemMaterial)
            menuPiece?.effect = blur
            pillPiece?.effect = blur
        }
    }

    private func applyScrim() {
        let color = scrimColor
        scrimLayer.colors = [
            color.withAlphaComponent(glassConfig.scrimAlpha).cgColor,
            color.withAlphaComponent(glassConfig.scrimAlpha * 0.55).cgColor,
            color.withAlphaComponent(0).cgColor,
        ]
        scrimLayer.locations = [0, 0.5, 1]
    }

    // MARK: - System-Tab-Bar (Apples eigene Leiste, unten)

    /// Hängt Apples `UITabBarController` als Kind über die WebView — mit
    /// leeren, durchsichtigen Platzhaltern, denn den Inhalt liefert weiterhin
    /// die WebView darunter. Die Pille oben tritt ab, der Menü-Button bleibt.
    private func enableSystemTabBar() {
        guard systemTabController == nil else { return }
        let controller = UITabBarController()
        controller.viewControllers = tabs.enumerated().map { pair -> UIViewController in
            let index = pair.offset
            let tab = pair.element
            let placeholder = UIViewController()
            placeholder.view.backgroundColor = .clear
            placeholder.view.isUserInteractionEnabled = false
            let filled = UIImage(systemName: tab.symbol + ".fill")
            placeholder.tabBarItem = UITabBarItem(
                title: tab.label,
                image: UIImage(systemName: tab.symbol),
                selectedImage: filled ?? UIImage(systemName: tab.symbol))
            placeholder.tabBarItem.tag = index
            return placeholder
        }
        controller.delegate = self
        controller.view.backgroundColor = .clear

        let overlay = PassthroughView()
        overlay.interactiveView = controller.tabBar
        overlay.translatesAutoresizingMaskIntoConstraints = false
        overlay.alpha = 0
        view.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.topAnchor.constraint(equalTo: view.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        addChild(controller)
        controller.view.frame = overlay.bounds
        controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.addSubview(controller.view)
        controller.didMove(toParent: self)

        systemTabController = controller
        tabOverlay = overlay
        applySystemTabAppearance()
        syncSystemTabSelection()
        pillPiece.isHidden = true
        indicatorView.isHidden = true
        tabStack.isHidden = true
        chromeContainer.interactiveViews = [menuPiece!]
        lastAppliedHidden = nil
        applyChromeVisibility()
    }

    private func disableSystemTabBar() {
        guard let controller = systemTabController else { return }
        controller.willMove(toParent: nil)
        controller.view.removeFromSuperview()
        controller.removeFromParent()
        tabOverlay?.removeFromSuperview()
        systemTabController = nil
        tabOverlay = nil
        pillPiece.isHidden = false
        indicatorView.isHidden = false
        tabStack.isHidden = false
        chromeContainer.interactiveViews = [menuPiece!, pillPiece!, tabStack!]
        lastAppliedHidden = nil
        reportedBottomInset = -1
        applyChromeVisibility()
        reportBottomInset()
    }

    private func applySystemTabAppearance() {
        guard let controller = systemTabController else { return }
        controller.overrideUserInterfaceStyle = isLightTheme ? .light : .dark
        controller.view.tintColor = activeColor
    }

    private func syncSystemTabSelection() {
        guard let controller = systemTabController else { return }
        guard let index = tabs.firstIndex(where: { $0.id == activeTabId }),
              controller.viewControllers?.indices.contains(index) == true,
              controller.selectedIndex != index else { return }
        syncingSystemSelection = true
        controller.selectedIndex = index
        syncingSystemSelection = false
    }

    /// Meldet der Web-App, wie viel die System-Leiste unten verdeckt, damit
    /// Composer und Listen darüber enden (CSS-Variable, kein Web-Code nötig).
    private func reportBottomInset() {
        var inset: CGFloat = 0
        if let controller = systemTabController, lastAppliedHidden == false {
            let barTop = controller.tabBar.frame.minY
            inset = max(0, view.bounds.height - barTop)
        }
        inset = inset.rounded()
        guard inset != reportedBottomInset else { return }
        reportedBottomInset = inset
        let flag = inset > 0 ? "'1'" : "''"
        runJS(
            "document.documentElement.style.setProperty('--native-tabbar-h','\(Int(inset))px');"
            + "document.documentElement.dataset.nativeTabbar=\(flag);")
    }

    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        guard !syncingSystemSelection else { return }
        let index = viewController.tabBarItem.tag
        guard tabs.indices.contains(index) else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        navigate(to: tabs[index].id)
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
        navigate(to: tabs[sender.tag].id)
    }

    /// Optimistisch sofort umschalten; die Web-App bestätigt nach Navigation
    /// und korrigiert, falls sie woanders landet (Konto nicht verbunden).
    private func navigate(to id: String) {
        if activeTabId != id {
            activeTabId = id
            applyActiveTab(animated: true)
        }
        runJS("window.__nativeNavigate && window.__nativeNavigate('\(id)')")
    }

    // MARK: - Web -> Nativ

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeChrome", let body = message.body as? [String: Any] else { return }
        chromeReady = true
        if let hidden = body["hidden"] as? Bool {
            hiddenByWeb = hidden
        }
        if let theme = body["theme"] as? String {
            let light = theme == "light"
            if light != isLightTheme {
                isLightTheme = light
                applyTheme()
            }
        }
        if let hex = body["accent"] as? String, let color = Self.color(fromHex: hex) {
            accent = color
            updateIndicatorTint()
            applySystemTabAppearance()
        }
        if let active = body["active"] as? String {
            activeTabId = active
        }
        if let raw = body["glass"] as? [String: Any] {
            let next = Self.parseGlassConfig(from: raw, base: glassConfig)
            if next != glassConfig {
                glassConfig = next
                applyGlassConfig()
            }
        }
        applyActiveTab(animated: true)
        applyChromeVisibility()
    }

    // MARK: - Auswahl (Lozenge + Icons)

    private func symbolImage(_ name: String, active: Bool) -> UIImage? {
        let config = UIImage.SymbolConfiguration(
            pointSize: glassConfig.iconSize, weight: active ? .semibold : .medium)
        if active, glassConfig.iconFilledWhenActive,
           let filled = UIImage(systemName: name + ".fill", withConfiguration: config) {
            return filled
        }
        return UIImage(systemName: name, withConfiguration: config)
    }

    private func updateIndicatorTint() {
        guard let indicator = indicatorView else { return }
        if #available(iOS 26.0, *), let glassIndicator = indicator as? UIVisualEffectView {
            let next = glassEffect(tinted: true)
            UIView.animate(withDuration: 0.25) { glassIndicator.effect = next }
            return
        }
        indicator.backgroundColor = lozengeColor.withAlphaComponent(glassConfig.tintAlpha * 0.5)
        indicator.layer.borderColor = lozengeColor.withAlphaComponent(glassConfig.tintAlpha * 0.7).cgColor
    }

    private func applyActiveTab(animated: Bool) {
        guard !tabButtons.isEmpty else { return }
        let newIndex = tabs.firstIndex { $0.id == activeTabId }
        let changed = newIndex != currentActiveIndex
        currentActiveIndex = newIndex

        for (index, tab) in tabs.enumerated() {
            let isActive = index == newIndex
            let button = tabButtons[index]
            var config = button.configuration
            config?.baseForegroundColor = isActive ? activeColor : .secondaryLabel
            config?.image = symbolImage(tab.symbol, active: isActive)
            let apply = { button.configuration = config }
            if animated && changed {
                UIView.transition(
                    with: button, duration: 0.2,
                    options: [.transitionCrossDissolve, .allowUserInteraction],
                    animations: apply, completion: nil)
            } else {
                apply()
            }
        }

        syncSystemTabSelection()
        if animated, changed, let index = newIndex, tabButtons.indices.contains(index) {
            popIcon(tabButtons[index])
        }
        layoutIndicator(animated: animated && changed)
    }

    /// Kurzer Stauch-Impuls auf dem frisch gewählten Tab (System-Gefühl).
    private func popIcon(_ button: UIButton) {
        button.transform = CGAffineTransform(scaleX: 0.86, y: 0.86)
        UIView.animate(
            withDuration: 0.45, delay: 0, usingSpringWithDamping: 0.5,
            initialSpringVelocity: 0,
            options: [.allowUserInteraction, .beginFromCurrentState]
        ) {
            button.transform = .identity
        }
    }

    /// Liquid-Morph des Lozenge: zieht sich in Laufrichtung lang, wird flacher,
    /// kommt etwas zu schmal an und federt auf Endgrösse — der Container
    /// verschmilzt die Formen nur, WÄHREND sie sich bewegen.
    private func flowIndicator(_ indicator: UIView, to center: CGPoint, size: CGSize) {
        let from = indicator.center
        let distance = abs(center.x - from.x)
        guard distance > 1 else {
            indicator.bounds = CGRect(origin: .zero, size: size)
            indicator.center = center
            return
        }
        let stretch = min(distance * 0.5, size.width * 0.9)
        UIView.animateKeyframes(
            withDuration: glassConfig.switchDuration, delay: 0,
            options: [.allowUserInteraction, .beginFromCurrentState, .calculationModeCubic]
        ) {
            UIView.addKeyframe(withRelativeStartTime: 0, relativeDuration: 0.55) {
                indicator.bounds = CGRect(x: 0, y: 0, width: size.width + stretch, height: size.height * 0.93)
                indicator.center = CGPoint(x: from.x + (center.x - from.x) * 0.6, y: center.y)
            }
            UIView.addKeyframe(withRelativeStartTime: 0.55, relativeDuration: 0.28) {
                indicator.bounds = CGRect(x: 0, y: 0, width: size.width * 0.93, height: size.height * 1.02)
                indicator.center = center
            }
            UIView.addKeyframe(withRelativeStartTime: 0.83, relativeDuration: 0.17) {
                indicator.bounds = CGRect(origin: .zero, size: size)
                indicator.center = center
            }
        }
    }

    private func layoutIndicator(animated: Bool) {
        guard let indicator = indicatorView, let stack = tabStack, !tabButtons.isEmpty,
              systemTabController == nil else { return }
        guard let index = tabs.firstIndex(where: { $0.id == activeTabId }),
              tabButtons.indices.contains(index) else {
            // Route ohne eigenen Tab (Dashboard, Einstellungen): kein Lozenge.
            setIndicator(hidden: true, animated: animated)
            return
        }
        stack.layoutIfNeeded()
        let button = tabButtons[index]
        guard button.bounds.width > 1, button.bounds.height > 10 else { return }
        let size = CGSize(
            width: button.bounds.width - glassConfig.lozengeInsetX * 2,
            height: button.bounds.height - glassConfig.lozengeInsetY * 2)
        let center = chromeContainer.contentView.convert(button.center, from: stack)
        let wasVisible = indicator.alpha > 0
        if #unavailable(iOS 26.0) {
            indicator.layer.cornerRadius = size.height / 2
        }
        let apply = {
            indicator.bounds = CGRect(origin: .zero, size: size)
            indicator.center = center
        }
        if animated, wasVisible, glassConfig.switchStyle == "flow", indicator.bounds.width > 1 {
            flowIndicator(indicator, to: center, size: size)
            setIndicator(hidden: false, animated: animated)
            return
        }
        if animated && wasVisible && (glassConfig.switchStyle == "fade" || glassConfig.switchDuration <= 0.02) {
            UIView.animate(
                withDuration: 0.12, delay: 0,
                options: [.allowUserInteraction, .beginFromCurrentState],
                animations: { indicator.alpha = 0 },
                completion: { [weak self] _ in
                    guard let self else { return }
                    guard self.tabs.firstIndex(where: { $0.id == self.activeTabId }) == index else { return }
                    apply()
                    UIView.animate(
                        withDuration: 0.18, delay: 0,
                        options: [.allowUserInteraction, .beginFromCurrentState],
                        animations: { indicator.alpha = 1 }, completion: nil)
                })
            return
        }
        if animated && wasVisible {
            UIView.animate(
                withDuration: glassConfig.switchDuration, delay: 0,
                usingSpringWithDamping: glassConfig.switchDamping,
                initialSpringVelocity: 0.5,
                options: [.allowUserInteraction, .beginFromCurrentState],
                animations: apply, completion: nil)
        } else {
            apply()
        }
        setIndicator(hidden: false, animated: animated)
    }

    private func setIndicator(hidden: Bool, animated: Bool) {
        guard let indicator = indicatorView else { return }
        let target: CGFloat = hidden ? 0 : 1
        if indicator.alpha == target { return }
        if animated {
            UIView.animate(
                withDuration: 0.2, delay: 0,
                options: [.allowUserInteraction, .beginFromCurrentState]
            ) {
                indicator.alpha = target
            }
        } else {
            indicator.alpha = target
        }
    }

    // MARK: - Config-Parsing

    /// Nimmt nur Felder an, die geliefert werden — ein älterer Web-Stand
    /// lässt den Rest auf den Binary-Defaults.
    private static func parseGlassConfig(from raw: [String: Any], base: GlassConfig) -> GlassConfig {
        var config = base
        if let v = raw["clearStyle"] as? Bool { config.clearStyle = v }
        if let v = raw["interactive"] as? Bool { config.interactive = v }
        if let v = raw["spacing"] as? Double { config.spacing = CGFloat(v) }
        if let v = raw["tintAlpha"] as? Double { config.tintAlpha = CGFloat(v) }
        if raw.keys.contains("tintHex") { config.tintHex = raw["tintHex"] as? String }
        if raw.keys.contains("activeHex") { config.activeHex = raw["activeHex"] as? String }
        if raw.keys.contains("scrimHex") { config.scrimHex = raw["scrimHex"] as? String }
        if let v = raw["scrimAlpha"] as? Double { config.scrimAlpha = CGFloat(v) }
        if let v = raw["lozengeInsetX"] as? Double { config.lozengeInsetX = CGFloat(v) }
        if let v = raw["lozengeInsetY"] as? Double { config.lozengeInsetY = CGFloat(v) }
        if let v = raw["switchStyle"] as? String { config.switchStyle = v }
        if let v = raw["switchDuration"] as? Double { config.switchDuration = v }
        if let v = raw["switchDamping"] as? Double { config.switchDamping = CGFloat(v) }
        if let v = raw["iconSize"] as? Double { config.iconSize = CGFloat(v) }
        if let v = raw["iconFilledWhenActive"] as? Bool { config.iconFilledWhenActive = v }
        if let v = raw["controlHeight"] as? Double { config.controlHeight = CGFloat(v) }
        if let v = raw["tabWidth"] as? Double { config.tabWidth = CGFloat(v) }
        if let v = raw["sideMargin"] as? Double { config.sideMargin = CGFloat(v) }
        if let v = raw["topInset"] as? Double { config.topInset = CGFloat(v) }
        if let v = raw["useSystemTabBar"] as? Bool { config.useSystemTabBar = v }
        if let v = raw["labelSize"] as? Double { config.labelSize = CGFloat(v) }
        return config
    }

    private static func color(fromHex hex: String) -> UIColor? {
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6, let rgb = UInt32(value, radix: 16) else { return nil }
        return UIColor(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1)
    }

    // MARK: - Sichtbarkeit

    @objc private func keyboardWillShow() {
        hiddenByKeyboard = true
        applyChromeVisibility()
    }

    @objc private func keyboardWillHide() {
        hiddenByKeyboard = false
        applyChromeVisibility()
    }

    private func applyChromeVisibility() {
        guard chromeContainer != nil else { return }
        // Ab 1024 pt zeigt die Web-App ihr Desktop-Layout samt eigener Sidebar.
        let desktopChrome = view.bounds.width >= 1024
        let hidden = !chromeReady || hiddenByWeb || hiddenByKeyboard || desktopChrome
        if hidden == lastAppliedHidden { return }
        lastAppliedHidden = hidden
        chromeContainer.isUserInteractionEnabled = !hidden
        scrimView.isHidden = desktopChrome
        UIView.animate(withDuration: 0.24, delay: 0, options: [.curveEaseOut]) {
            self.chromeContainer.alpha = hidden ? 0 : 1
            self.chromeContainer.transform = hidden ? CGAffineTransform(translationX: 0, y: -10) : .identity
            self.scrimView.alpha = hidden && !self.hiddenByKeyboard ? 0 : 1
        }
        if let overlay = tabOverlay {
            overlay.isUserInteractionEnabled = !hidden
            UIView.animate(withDuration: 0.24, delay: 0, options: [.curveEaseOut]) {
                overlay.alpha = hidden ? 0 : 1
                overlay.transform = hidden ? CGAffineTransform(translationX: 0, y: 12) : .identity
            }
        }
        reportBottomInset()
    }
}

/// Glas-Container, der nur Berührungen seiner interaktiven Kinder annimmt und
/// alles andere (den leeren Streifen zwischen Menü und Pille) an die WebView
/// durchreicht.
final class ChromeContainerView: UIVisualEffectView {
    var interactiveViews: [UIView] = []

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let hit = super.hitTest(point, with: event) else { return nil }
        var node: UIView? = hit
        while let current = node {
            if interactiveViews.contains(where: { $0 === current }) { return hit }
            node = current.superview
        }
        return nil
    }
}

/// Overlay, das nur Berührungen EINER View annimmt und alles andere nach
/// unten durchreicht (System-Tab-Bar belegt sonst die ganze Fläche).
final class PassthroughView: UIView {
    weak var interactiveView: UIView?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let hit = super.hitTest(point, with: event),
              let interactive = interactiveView else { return nil }
        var node: UIView? = hit
        while let current = node {
            if current === interactive { return hit }
            node = current.superview
        }
        return nil
    }
}
