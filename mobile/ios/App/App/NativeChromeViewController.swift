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
///                 {hidden?, active?, theme?, accent?, glass?, tabs?})
/// Ab 1.0.5: html[data-native-tabs="1"] — die Hülle nimmt `tabs`
/// ([{id, symbol, label, action?}]) an. Dann gibt es nur Apples System-Leiste
/// unten mit genau diesen Tabs (pro Paket verschieden), Tipp ruft
/// window.__nativeNavigate(id); oben bleibt nichts Natives.
/// Ab 1.0.6: html[data-native-kreis="1"] — ein Aktions-Tab mit
/// `placement: "trailing"` sitzt unter iOS 26 als eigener Kreis rechts neben
/// der Leiste (Platz des Such-Tabs, UISearchTab) und wird nie ausgewählt;
/// `farben` ({fill, ink, ring}) färbt ihn wie im Web (Steno-Gelb, Ring aus den
/// Bot-Farben). Ältere iOS zeigen ihn als Tab in der Leiste.
/// Ab 1.0.6: html[data-native-aktionen="1"] — Feld `aktionen` ({text?, knoepfe,
/// akzent?, tinte?} | null): die Aktionsleiste der Seite in echtem Liquid Glass
/// (NativeAktionsleiste.swift), Tipp ruft window.__nativeAktion(id). Apples
/// Tab-Leiste geht ab iOS 18 mit setTabBarHidden weg und wieder herein.
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
        var aktionKreis: CGFloat = 44   // Scheibe bzw. Ring im Kreis neben der Leiste (iOS 26)
        var aktionSymbol: CGFloat = 21  // Mikrofon darin
    }
    private var glassConfig = GlassConfig()

    /// Laufende Aufnahmen in Dynamic Island + Sperrbildschirm (LiveActivityBridge.swift)
    private let liveActivity = LiveActivityBridge()
    /// Aufnahme bei gesperrtem iPhone (NativeAufnahme.swift, ab 1.0.6)
    private let aufnahme = NativeAufnahme()
    /// Aktionsleiste der Seite in Liquid Glass (NativeAktionsleiste.swift, ab 1.0.6)
    private let aktionsleiste = NativeAktionsleiste()
    private var aktionsInhalt: NativeAktionsleiste.Inhalt?
    private var aktionenSichtbar = false
    private var gemeldeteAktionsHoehe: CGFloat = -1
    /// Meldung (Toast) in Liquid Glass über der Leiste (NativeMeldung.swift, ab 1.0.6 Build 3)
    private let meldung = NativeMeldung()
    private var meldungUnten: NSLayoutConstraint?
    /// Kopfleiste oben in Liquid Glass (NativeKopfleiste.swift, ab 1.0.6 Build 4, nur iOS 26)
    private let kopfleiste = NativeKopfleiste()
    /// PDFs und andere Dateien in QuickLook statt im App-Fenster (NativeDatei.swift, ab 1.0.6 Build 25)
    private let datei = NativeDatei()
    private let dateiNavigation = NativeDateiNavigation()
    private var kopfInhalt: NativeKopfleiste.Inhalt?
    private var kopfSichtbar = false

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
    private let pillTabs: [(id: String, symbol: String, label: String)] = [
        ("chat", "message", "Chat"),
        ("mail", "envelope", "Mail"),
        ("calendar", "calendar", "Kalender"),
    ]

    /// Tabs der System-Leiste unten. Ab 1.0.5 schickt die Web-App sie selbst
    /// (Feld `tabs`, pro Paket verschieden) — neue Tabs ohne App-Store-Durchlauf.
    /// Ohne Feld (ältere Web-Stände) gilt die Pillen-Liste.
    private struct SystemTab: Equatable {
        let id: String
        let symbol: String
        let label: String
        /// Aktions-Tab (Diktat): farbiges Symbol, löst aus statt auszuwählen.
        let action: Bool
        /// Ab 1.0.6: als eigener Kreis rechts neben der Leiste (iOS 26)
        var trailing = false
        /// Farben aus der Web-App (Tokens des Produkts) — leer = Systemfarben
        var fill: [UIColor] = []
        var ink: UIColor?
        var ring: [UIColor] = []
    }
    private var webTabs: [SystemTab] = []
    private var systemTabs: [SystemTab] {
        if !webTabs.isEmpty { return webTabs }
        return pillTabs.map { SystemTab(id: $0.id, symbol: $0.symbol, label: $0.label, action: false) }
    }
    /// Web-App führt die Tabs: dann gibt es nur die Leiste unten — Menü, Pille
    /// und Scrim oben entfallen (Kopfzeile und «Mehr» liefert die Web-App).
    private var webTabsMode: Bool { !webTabs.isEmpty }

    /// iOS 26: der Aktions-Tab, der als eigener Kreis neben der Leiste sitzt
    private var kreisTab: SystemTab? {
        guard #available(iOS 26.0, *) else { return nil }
        return systemTabs.last { $0.action && $0.trailing }
    }
    /// Die Leiste ist mit UITab gebaut (Kreis) statt mit viewControllers —
    /// beides lässt sich nicht mischen, ein Wechsel baut sie neu.
    private var tabModusKreis = false
    /// Tipp auf den Aktions-Tab nur einmal auslösen (manche iOS melden beide Delegate-Wege)
    private var letzteAktion = Date.distantPast
    /// Dasselbe für die Auswahl eines Tabs
    private var letzteWahl: (id: String, zeit: Date)?
    private var kreisAktivBild = ""

    // MARK: - Lifecycle

    /// Vor dem ersten Laden: Datei-Links fängt dieses Plugin ab (NativeDatei.swift)
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        dateiNavigation.datei = datei
        bridge?.registerPluginInstance(dateiNavigation)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let webView = self.webView else { return }

        // Web-App informieren, dass natives Chrome verfügbar ist (überlebt
        // Reloads), und den Rückkanal registrieren.
        // nativeKopf: Zurück und Kopf-Knöpfe zeichnet die Hülle in Liquid Glass (nur iOS 26)
        var kopfFlag = ""
        if #available(iOS 26.0, *) { kopfFlag = ";document.documentElement.dataset.nativeKopf = '1'" }
        let flagScript = WKUserScript(
            // nativeTabs: diese Hülle nimmt Tabs von der Web-App an (ab 1.0.5);
            // nativeKreis: der Aktions-Tab darf als Kreis neben der Leiste sitzen (ab 1.0.6)
            source: "document.documentElement.dataset.nativeChrome = '1';"
                + "document.documentElement.dataset.nativeTabs = '1';"
                + "document.documentElement.dataset.nativeKreis = '1';"
                + "document.documentElement.dataset.nativeAktionen = '1';"
                + "document.documentElement.dataset.nativeMeldung = '1'"
                + kopfFlag,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        webView.configuration.userContentController.addUserScript(flagScript)
        webView.configuration.userContentController.add(self, name: "nativeChrome")
        // Eigener Kanal: eine Meldung darf das Chrome nicht «bereit» schalten (Login-Seite)
        webView.configuration.userContentController.add(self, name: "meldung")
        liveActivity.attach(to: webView)
        aufnahme.attach(to: webView, insel: liveActivity)
        NativePush.shared.attach(to: webView)
        datei.attach(to: webView, anzeiger: self)

        setupChrome()
        applyTheme()

        // Links aus der Insel und dem Browser (spacemedia://oeffne, spacemedia://konto)
        NotificationCenter.default.addObserver(
            self, selector: #selector(pfadOeffnen), name: AppDelegate.oeffnePfad, object: nil)
        if AppDelegate.wartenderPfad != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.pfadOeffnen() }
        }
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
        meldeAktionsHoehe()
        layoutMeldung()
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            self?.applyChromeVisibility()
            self?.layoutIndicator(animated: false)
            self?.applyAktionsleiste()
            self?.applyKopfleiste()
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
        // Aktionsleiste unten (Seiten ohne Tab-Leiste): erst sichtbar, wenn die Web-App Knöpfe meldet
        aktionsleiste.translatesAutoresizingMaskIntoConstraints = false
        aktionsleiste.isHidden = true
        aktionsleiste.alpha = 0
        aktionsleiste.onTipp = { [weak self] id in
            self?.runJS("window.__nativeAktion && window.__nativeAktion('\(id)')")
        }
        view.addSubview(aktionsleiste)
        NSLayoutConstraint.activate([
            aktionsleiste.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            aktionsleiste.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            aktionsleiste.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        // Kopfleiste: auf der 44-pt-Zeile der Web-Kopfzeile, unter der Statusleiste
        kopfleiste.translatesAutoresizingMaskIntoConstraints = false
        kopfleiste.isHidden = true
        kopfleiste.alpha = 0
        kopfleiste.onTipp = { [weak self] id in
            guard id.range(of: "^[a-z0-9-]{1,32}$", options: .regularExpression) != nil else { return }
            self?.runJS("window.__nativeKopf && window.__nativeKopf('\(id)')")
        }
        view.addSubview(kopfleiste)
        NSLayoutConstraint.activate([
            kopfleiste.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            kopfleiste.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            kopfleiste.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            kopfleiste.heightAnchor.constraint(equalToConstant: 44),
        ])

        // Meldung: 12 pt über dem, was unten belegt ist (layoutMeldung), nie unter der Tastatur
        meldung.translatesAutoresizingMaskIntoConstraints = false
        meldung.onAntwort = { [weak self] id, art in
            guard id.range(of: "^[a-z0-9-]{1,32}$", options: .regularExpression) != nil,
                  ["gezeigt", "aktion", "zu"].contains(art) else { return }
            self?.runJS("window.__nativeMeldung && window.__nativeMeldung('\(id)','\(art)')")
        }
        view.addSubview(meldung)
        let unten = meldung.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -60)
        unten.priority = .defaultHigh
        meldungUnten = unten
        NSLayoutConstraint.activate([
            meldung.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            meldung.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            meldung.bottomAnchor.constraint(lessThanOrEqualTo: view.keyboardLayoutGuide.topAnchor, constant: -12),
            unten,
        ])

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
        for (index, tab) in pillTabs.enumerated() {
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
        CGFloat(pillTabs.count) * glassConfig.tabWidth + 8
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

        updateSystemTabBarPresence()
        if tabModusKreis { reloadSystemTabs() }
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
        applyAktionsleiste()
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
        controller.delegate = self
        tabModusKreis = false
        if #available(iOS 26.0, *), kreisTab != nil {
            controller.tabs = makeKreisTabs()
            tabModusKreis = true
        } else {
            controller.viewControllers = makeSystemTabControllers()
        }
        kreisAktivBild = ""
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

    /// Leiste unten an/aus: die Web-App führt Tabs (immer, jede iOS-Version)
    /// oder `glass.useSystemTabBar` (nur iOS 26, sonst bleibt die Pille).
    private func updateSystemTabBarPresence() {
        guard chromeContainer != nil else { return }
        var wanted = webTabsMode
        if #available(iOS 26.0, *) { wanted = wanted || glassConfig.useSystemTabBar }
        if wanted { enableSystemTabBar() } else { disableSystemTabBar() }
    }

    /// Leere, durchsichtige Platzhalter — den Inhalt liefert die WebView.
    private func makeSystemTabControllers() -> [UIViewController] {
        systemTabs.enumerated().map { pair -> UIViewController in
            let index = pair.offset
            let tab = pair.element
            let placeholder = UIViewController()
            placeholder.view.backgroundColor = .clear
            placeholder.view.isUserInteractionEnabled = false
            if tab.action {
                placeholder.tabBarItem = UITabBarItem(title: tab.label, image: aktionsTabBild(tab), selectedImage: aktionsTabBild(tab))
            } else {
                let filled = UIImage(systemName: tab.symbol + ".fill")
                placeholder.tabBarItem = UITabBarItem(
                    title: tab.label,
                    image: UIImage(systemName: tab.symbol),
                    selectedImage: filled ?? UIImage(systemName: tab.symbol))
            }
            placeholder.tabBarItem.tag = index
            return placeholder
        }
    }

    /// Mikrofon im Kreis als Tab in der Leiste (ältere iOS, ältere Web-Stände):
    /// bleibt in jedem Zustand gleich. Ab 1.0.6 in den Farben des Produkts.
    private func aktionsTabBild(_ tab: SystemTab) -> UIImage? {
        let kreisSymbol = tab.symbol.hasSuffix(".circle.fill")
            ? tab.symbol
            : tab.symbol.replacingOccurrences(of: ".fill", with: "") + ".circle.fill"
        let vorne = tab.ink ?? .white
        let hinten = tab.fill.last ?? tab.ring.first ?? .systemBlue
        let config = UIImage.SymbolConfiguration(pointSize: 24, weight: .semibold)
            .applying(UIImage.SymbolConfiguration(paletteColors: [vorne, hinten]))
        let image = UIImage(systemName: kreisSymbol, withConfiguration: config)
            ?? UIImage(systemName: tab.symbol, withConfiguration: config)
        return image?.withRenderingMode(.alwaysOriginal)
    }

    /// iOS 26: Tabs als UITab, der Aktions-Tab als Such-Tab — das System setzt ihn
    /// als eigenen Glas-Kreis rechts neben die Leiste. Ausgewählt wird er nie.
    @available(iOS 26.0, *)
    private func makeKreisTabs() -> [UITab] {
        systemTabs.map { tab -> UITab in
            let platzhalter: (UITab) -> UIViewController = { _ in
                let leer = UIViewController()
                leer.view.backgroundColor = .clear
                leer.view.isUserInteractionEnabled = false
                return leer
            }
            if tab.action && tab.trailing {
                let kreis = UISearchTab(viewControllerProvider: platzhalter)
                kreis.title = tab.label
                kreis.image = kreisBild(tab)
                return kreis
            }
            let bild = tab.action ? aktionsTabBild(tab) : tabBild(tab, aktiv: tab.id == activeTabId)
            return UITab(title: tab.label, image: bild, identifier: tab.id, viewControllerProvider: platzhalter)
        }
    }

    private func tabBild(_ tab: SystemTab, aktiv: Bool) -> UIImage? {
        if aktiv, let gefuellt = UIImage(systemName: tab.symbol + ".fill") { return gefuellt }
        return UIImage(systemName: tab.symbol)
    }

    /// Bild im Kreis neben der Leiste. Steno: Scheibe im Verlauf (Steno-Gelb) mit
    /// Mikrofon; Bot-Team: Ring aus den Bot-Farben ums Mikrofon. Die Grössen kommen
    /// aus der Glas-Konfiguration der Web-App (nachjustieren ohne App Store).
    private func kreisBild(_ tab: SystemTab) -> UIImage? {
        let d = glassConfig.aktionKreis
        let groesse = CGSize(width: d, height: d)
        let ringModus = !tab.ring.isEmpty
        let ink = tab.ink ?? (ringModus
            ? (isLightTheme ? UIColor.black : UIColor.white)
            : UIColor(red: 26 / 255, green: 20 / 255, blue: 6 / 255, alpha: 1))
        let symbolName = tab.symbol.hasSuffix(".fill") ? tab.symbol : tab.symbol + ".fill"
        let symbol = (UIImage(systemName: symbolName) ?? UIImage(systemName: tab.symbol))?
            .applyingSymbolConfiguration(UIImage.SymbolConfiguration(pointSize: glassConfig.aktionSymbol, weight: .semibold))?
            .withTintColor(ink, renderingMode: .alwaysOriginal)
        let format = UIGraphicsImageRendererFormat.preferred()
        format.opaque = false
        let bild = UIGraphicsImageRenderer(size: groesse, format: format).image { ctx in
            let rect = CGRect(origin: .zero, size: groesse)
            if ringModus {
                // Wie conic-gradient(from 200deg, …) im Web: Bogenstücke mit weich gemischten Farben
                let breite: CGFloat = 2.5
                let mitte = CGPoint(x: d / 2, y: d / 2)
                let radius = d / 2 - breite / 2
                let farben = tab.ring + [tab.ring[0]]
                let start = -CGFloat.pi / 2 + CGFloat(200) / 180 * CGFloat.pi
                let stuecke = 120
                for i in 0..<stuecke {
                    let t0 = CGFloat(i) / CGFloat(stuecke)
                    let t1 = CGFloat(i + 1) / CGFloat(stuecke)
                    let bogen = UIBezierPath(
                        arcCenter: mitte, radius: radius,
                        startAngle: start + t0 * 2 * .pi, endAngle: start + t1 * 2 * .pi + 0.01,
                        clockwise: true)
                    bogen.lineWidth = breite
                    Self.mischen(farben, bei: (t0 + t1) / 2).setStroke()
                    bogen.stroke()
                }
            } else {
                let farben = tab.fill.isEmpty
                    ? [UIColor(red: 1, green: 213 / 255, blue: 107 / 255, alpha: 1),
                       UIColor(red: 246 / 255, green: 181 / 255, blue: 30 / 255, alpha: 1)]
                    : tab.fill
                let cg = ctx.cgContext
                cg.saveGState()
                UIBezierPath(ovalIn: rect).addClip()
                if farben.count >= 2,
                   let verlauf = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                            colors: farben.map { $0.cgColor } as CFArray, locations: nil) {
                    cg.drawLinearGradient(verlauf, start: CGPoint(x: d / 2, y: 0), end: CGPoint(x: d / 2, y: d), options: [])
                } else {
                    farben[0].setFill()
                    UIRectFill(rect)
                }
                cg.restoreGState()
            }
            if let symbol {
                let s = symbol.size
                symbol.draw(in: CGRect(x: (d - s.width) / 2, y: (d - s.height) / 2, width: s.width, height: s.height))
            }
        }
        return bild.withRenderingMode(.alwaysOriginal)
    }

    /// Farbe an der Stelle t (0…1) zwischen gleichmässig verteilten Stopps
    private static func mischen(_ farben: [UIColor], bei t: CGFloat) -> UIColor {
        guard farben.count > 1 else { return farben.first ?? .white }
        let pos = max(0, min(1, t)) * CGFloat(farben.count - 1)
        let i = min(Int(pos), farben.count - 2)
        let f = pos - CGFloat(i)
        var r0: CGFloat = 0, g0: CGFloat = 0, b0: CGFloat = 0, a0: CGFloat = 0
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
        farben[i].getRed(&r0, green: &g0, blue: &b0, alpha: &a0)
        farben[i + 1].getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        return UIColor(red: r0 + (r1 - r0) * f, green: g0 + (g1 - g0) * f,
                       blue: b0 + (b1 - b0) * f, alpha: a0 + (a1 - a0) * f)
    }

    /// Neue Tab-Liste (Paketwechsel, Login): Leiste neu bestücken.
    private func reloadSystemTabs() {
        guard let controller = systemTabController else { return }
        // Wechsel zwischen Kreis und Tab in der Leiste: Leiste neu bauen
        if (kreisTab != nil) != tabModusKreis {
            disableSystemTabBar()
            updateSystemTabBarPresence()
            return
        }
        syncingSystemSelection = true
        if #available(iOS 26.0, *), tabModusKreis {
            controller.tabs = makeKreisTabs()
            kreisAktivBild = activeTabId
        } else {
            controller.viewControllers = makeSystemTabControllers()
        }
        syncingSystemSelection = false
        syncSystemTabSelection()
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
        if #available(iOS 26.0, *), tabModusKreis {
            // Gefülltes Symbol nur beim aktiven Tab (wie die Web-Leiste). UITab.selectedImage
            // kennt das SDK von Xcode 26.3 noch nicht, darum tauscht die Hülle selbst.
            if kreisAktivBild != activeTabId {
                kreisAktivBild = activeTabId
                for tab in controller.tabs where !(tab is UISearchTab) {
                    if let eintrag = systemTabs.first(where: { $0.id == tab.identifier }), !eintrag.action {
                        tab.image = tabBild(eintrag, aktiv: eintrag.id == activeTabId)
                    }
                }
            }
            guard let ziel = controller.tabs.first(where: { $0.identifier == activeTabId && !($0 is UISearchTab) }),
                  controller.selectedTab !== ziel else { return }
            syncingSystemSelection = true
            controller.selectedTab = ziel
            syncingSystemSelection = false
            return
        }
        guard let index = systemTabs.firstIndex(where: { $0.id == activeTabId }),
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

    /// Aktions-Tab (Diktat) wählt nicht aus, sondern löst aus — wie ein Knopf.
    func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
        // Kreis-Modus: entscheidet shouldSelectTab (UITab)
        guard !tabModusKreis else { return true }
        let index = viewController.tabBarItem.tag
        guard systemTabs.indices.contains(index), systemTabs[index].action else { return true }
        aktionAusloesen(systemTabs[index])
        return false
    }

    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        guard !syncingSystemSelection, !tabModusKreis else { return }
        let index = viewController.tabBarItem.tag
        guard systemTabs.indices.contains(index) else { return }
        tabGewaehlt(systemTabs[index])
    }

    /// Ab iOS 18 meldet UIKit Tipps auch über UITab — im Kreis-Modus nur so, und
    /// für SwiftUI-Leisten meldet iOS 27 die alten Wege gar nicht mehr. Darum hier
    /// beide Modi; doppelt gemeldete Tipps zählen einmal (aktionAusloesen, tabGewaehlt).
    @available(iOS 18.0, *)
    func tabBarController(_ tabBarController: UITabBarController, shouldSelectTab tab: UITab) -> Bool {
        guard let eintrag = eintrag(fuer: tab), eintrag.action else { return true }
        aktionAusloesen(eintrag)
        return false
    }

    @available(iOS 18.0, *)
    func tabBarController(_ tabBarController: UITabBarController, didSelectTab selectedTab: UITab, previousTab: UITab?) {
        guard !syncingSystemSelection, let eintrag = eintrag(fuer: selectedTab), !eintrag.action else { return }
        tabGewaehlt(eintrag)
    }

    /// Unser Tab hinter einem UITab: Kreis über den Such-Tab, Kreis-Modus über die
    /// Kennung, klassisch (viewControllers) über den Platzhalter und seinen Tag.
    @available(iOS 18.0, *)
    private func eintrag(fuer tab: UITab) -> SystemTab? {
        if tab is UISearchTab { return systemTabs.last { $0.action && $0.trailing } }
        if tabModusKreis { return systemTabs.first { $0.id == tab.identifier } }
        guard let index = tab.viewController?.tabBarItem.tag, systemTabs.indices.contains(index) else { return nil }
        return systemTabs[index]
    }

    private func aktionAusloesen(_ tab: SystemTab) {
        guard Date().timeIntervalSince(letzteAktion) > 0.4 else { return }
        letzteAktion = Date()
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        runJS("window.__nativeNavigate && window.__nativeNavigate('\(tab.id)')")
    }

    private func tabGewaehlt(_ tab: SystemTab) {
        if let letzte = letzteWahl, letzte.id == tab.id, Date().timeIntervalSince(letzte.zeit) < 0.4 { return }
        letzteWahl = (tab.id, Date())
        UISelectionFeedbackGenerator().selectionChanged()
        navigate(to: tab.id)
    }

    // MARK: - Aktionen (Nativ -> Web)

    private func runJS(_ js: String) {
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    /// Wartenden Pfad in der Web-App öffnen (nur geprüfte eigene Pfade, AppDelegate.istEigenerPfad)
    @objc private func pfadOeffnen() {
        guard let pfad = AppDelegate.wartenderPfad, AppDelegate.istEigenerPfad(pfad) else { return }
        AppDelegate.wartenderPfad = nil
        runJS("window.location.assign('\(pfad)')")
    }

    @objc private func menuTapped() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        runJS("window.__nativeOpenDrawer && window.__nativeOpenDrawer()")
    }

    @objc private func tabTapped(_ sender: UIButton) {
        UISelectionFeedbackGenerator().selectionChanged()
        navigate(to: pillTabs[sender.tag].id)
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
        if message.name == "meldung" {
            meldungEmpfangen(message.body)
            return
        }
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
        if let rawTabs = body["tabs"] as? [[String: Any]] {
            let next: [SystemTab] = rawTabs.compactMap { (raw: [String: Any]) -> SystemTab? in
                guard let id = raw["id"] as? String, let symbol = raw["symbol"] as? String,
                      let label = raw["label"] as? String,
                      id.range(of: "^[a-z0-9-]{1,32}$", options: .regularExpression) != nil
                else { return nil }
                let farben = raw["farben"] as? [String: Any]
                return SystemTab(
                    id: id, symbol: symbol, label: label, action: raw["action"] as? Bool ?? false,
                    trailing: (raw["placement"] as? String) == "trailing",
                    fill: (farben?["fill"] as? [String] ?? []).compactMap { Self.color(fromHex: $0) },
                    ink: (farben?["ink"] as? String).flatMap { Self.color(fromHex: $0) },
                    ring: (farben?["ring"] as? [String] ?? []).compactMap { Self.color(fromHex: $0) })
            }
            if next != webTabs {
                let modeChanged = next.isEmpty != webTabs.isEmpty
                webTabs = next
                if modeChanged {
                    lastAppliedHidden = nil
                    updateSystemTabBarPresence()
                }
                reloadSystemTabs()
            }
        }
        if let raw = body["glass"] as? [String: Any] {
            let next = Self.parseGlassConfig(from: raw, base: glassConfig)
            if next != glassConfig {
                glassConfig = next
                applyGlassConfig()
            }
        }
        // Aktionsleiste der Seite (ab 1.0.6): null = keine (auch während ein Blatt offen ist)
        if body.keys.contains("aktionen") {
            aktionsInhalt = Self.parseAktionen(body["aktionen"])
        }
        // Kopfleiste der Seite (ab 1.0.6 Build 4): null = keine (auch während ein Blatt offen ist)
        if body.keys.contains("kopf") {
            kopfInhalt = Self.parseKopf(body["kopf"])
        }
        applyActiveTab(animated: true)
        applyChromeVisibility()
        applyAktionsleiste()
        applyKopfleiste()
    }

    /// Kopf aus der Web-App: eigene Kennungen, nur bekannte SF Symbols
    private static func parseKopf(_ roh: Any?) -> NativeKopfleiste.Inhalt? {
        guard let raw = roh as? [String: Any] else { return nil }
        let zurueck = (raw["zurueck"] as? [String: Any])?["label"] as? String
        let liste = raw["knoepfe"] as? [[String: Any]] ?? []
        let knoepfe = liste.compactMap { (k: [String: Any]) -> NativeKopfleiste.Knopf? in
            guard let id = k["id"] as? String, let symbol = k["symbol"] as? String,
                  let label = k["label"] as? String, !label.isEmpty,
                  id.range(of: "^[a-z0-9-]{1,32}$", options: .regularExpression) != nil,
                  symbol.range(of: "^[a-z0-9.]{1,64}$", options: .regularExpression) != nil,
                  UIImage(systemName: symbol) != nil
            else { return nil }
            return NativeKopfleiste.Knopf(id: id, symbol: symbol, label: String(label.prefix(60)), aus: k["aus"] as? Bool ?? false)
        }
        guard zurueck != nil || !knoepfe.isEmpty else { return nil }
        return NativeKopfleiste.Inhalt(zurueck: zurueck.map { String($0.prefix(40)) }, knoepfe: Array(knoepfe.prefix(2)))
    }

    /// Kopfleiste zeigen oder weg: nur iOS 26, Handy-Breite, Inhalt gemeldet
    private func applyKopfleiste() {
        var zeigen = false
        if #available(iOS 26.0, *) {
            zeigen = chromeReady && kopfInhalt != nil && view.bounds.width < 1024
        }
        if let inhalt = kopfInhalt {
            kopfleiste.setze(inhalt, hell: isLightTheme)
        }
        guard zeigen != kopfSichtbar else { return }
        kopfSichtbar = zeigen
        if zeigen {
            kopfleiste.isHidden = false
            view.bringSubviewToFront(kopfleiste)
        }
        UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.kopfleiste.alpha = zeigen ? 1 : 0
        } completion: { _ in
            if !self.kopfSichtbar { self.kopfleiste.isHidden = true }
        }
    }

    /// Knöpfe aus der Web-App: nur eigene Kennungen (sie landen in einem JS-Aufruf)
    private static func parseAktionen(_ roh: Any?) -> NativeAktionsleiste.Inhalt? {
        guard let raw = roh as? [String: Any], let liste = raw["knoepfe"] as? [[String: Any]] else { return nil }
        let knoepfe = liste.compactMap { (k: [String: Any]) -> NativeAktionsleiste.Knopf? in
            guard let id = k["id"] as? String, let label = k["label"] as? String, !label.isEmpty,
                  id.range(of: "^[a-z0-9-]{1,32}$", options: .regularExpression) != nil
            else { return nil }
            return NativeAktionsleiste.Knopf(
                id: id, label: String(label.prefix(60)),
                haupt: (k["stil"] as? String) == "haupt", aus: k["aus"] as? Bool ?? false)
        }
        guard !knoepfe.isEmpty else { return nil }
        return NativeAktionsleiste.Inhalt(
            text: (raw["text"] as? String).map { String($0.prefix(160)) },
            knoepfe: Array(knoepfe.prefix(3)),
            akzent: (raw["akzent"] as? String).flatMap { Self.color(fromHex: $0) },
            tinte: (raw["tinte"] as? String).flatMap { Self.color(fromHex: $0) })
    }

    /// Aktionsleiste zeigen oder weg: Knöpfe gemeldet, keine Tastatur, Handy-Breite
    private func applyAktionsleiste() {
        let desktopChrome = view.bounds.width >= 1024
        let zeigen = chromeReady && !hiddenByKeyboard && !desktopChrome && aktionsInhalt != nil
        if let inhalt = aktionsInhalt {
            aktionsleiste.setze(inhalt, hell: isLightTheme, grund: scrimColor)
        }
        guard zeigen != aktionenSichtbar else { return }
        aktionenSichtbar = zeigen
        let ruhig = UIAccessibility.isReduceMotionEnabled
        let weg = ruhig ? CGAffineTransform.identity : CGAffineTransform(translationX: 0, y: 28)
        if zeigen {
            aktionsleiste.isHidden = false
            view.bringSubviewToFront(aktionsleiste)
            aktionsleiste.transform = weg
            UIView.animate(
                withDuration: ruhig ? 0.2 : 0.46, delay: 0, usingSpringWithDamping: 0.86,
                initialSpringVelocity: 0, options: [.allowUserInteraction, .beginFromCurrentState]
            ) {
                self.aktionsleiste.alpha = 1
                self.aktionsleiste.transform = .identity
            }
            view.layoutIfNeeded()
            meldeAktionsHoehe()
            layoutMeldung()
        } else {
            UIView.animate(withDuration: 0.2, delay: 0, options: [.curveEaseIn, .beginFromCurrentState]) {
                self.aktionsleiste.alpha = 0
                self.aktionsleiste.transform = weg
            } completion: { _ in
                if !self.aktionenSichtbar { self.aktionsleiste.isHidden = true }
                self.layoutMeldung()
            }
        }
    }

    /// Wie viel die Aktionsleiste unten belegt — die Seite polstert darüber (--native-aktionen-h)
    private func meldeAktionsHoehe() {
        guard aktionenSichtbar else { return }
        let hoehe = aktionsleiste.bounds.height.rounded()
        guard hoehe > 0, hoehe != gemeldeteAktionsHoehe else { return }
        gemeldeteAktionsHoehe = hoehe
        runJS("document.documentElement.style.setProperty('--native-aktionen-h','\(Int(hoehe))px')")
    }

    // MARK: - Meldung (Toast)

    private static let meldungTypen: Set<String> = ["erfolg", "fehler", "info", "warnung", "laden", "normal"]

    /// {meldung: {id, typ, titel, text?, aktion?, hell} | null} — nur eigene Kennungen,
    /// Texte gekürzt (sie landen in einem Label, nicht in JS)
    private func meldungEmpfangen(_ roh: Any) {
        guard let body = roh as? [String: Any] else { return }
        guard let m = body["meldung"] as? [String: Any],
              let id = m["id"] as? String, id.range(of: "^[a-z0-9-]{1,32}$", options: .regularExpression) != nil,
              let titel = m["titel"] as? String, !titel.isEmpty
        else {
            meldung.verstecke()
            return
        }
        let typ = (m["typ"] as? String).flatMap { Self.meldungTypen.contains($0) ? $0 : nil } ?? "normal"
        let inhalt = NativeMeldung.Inhalt(
            id: id, typ: typ, titel: String(titel.prefix(120)),
            text: (m["text"] as? String).map { String($0.prefix(200)) },
            aktion: (m["aktion"] as? String).map { String($0.prefix(24)) },
            hell: m["hell"] as? Bool ?? isLightTheme)
        layoutMeldung()
        view.bringSubviewToFront(meldung)
        meldung.zeige(inhalt, akzent: accent)
        meldung.onAntwort?(id, "gezeigt")
    }

    /// Die Meldung sitzt 12 pt über dem, was unten belegt ist: Home-Indikator,
    /// Apples Tab-Leiste (sichtbar) oder die Aktionsleiste der Seite.
    private func layoutMeldung() {
        guard let unten = meldungUnten else { return }
        var belegt = view.safeAreaInsets.bottom
        if let controller = systemTabController, lastAppliedHidden == false {
            let barTop = controller.tabBar.convert(controller.tabBar.bounds, to: view).minY
            belegt = max(belegt, view.bounds.height - barTop)
        }
        if aktionenSichtbar {
            belegt = max(belegt, view.bounds.height - aktionsleiste.frame.minY - 14)
        }
        let neu = -(belegt.rounded() + 12)
        guard unten.constant != neu else { return }
        unten.constant = neu
        if meldung.sichtbar {
            UIView.animate(withDuration: 0.25, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
                self.view.layoutIfNeeded()
            }
        }
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
        let newIndex = pillTabs.firstIndex { $0.id == activeTabId }
        let changed = newIndex != currentActiveIndex
        currentActiveIndex = newIndex

        for (index, tab) in pillTabs.enumerated() {
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
        guard let index = pillTabs.firstIndex(where: { $0.id == activeTabId }),
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
                    guard self.pillTabs.firstIndex(where: { $0.id == self.activeTabId }) == index else { return }
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
        if let v = raw["aktionKreis"] as? Double { config.aktionKreis = CGFloat(max(24, min(60, v))) }
        if let v = raw["aktionSymbol"] as? Double { config.aktionSymbol = CGFloat(max(12, min(30, v))) }
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
        applyAktionsleiste()
    }

    @objc private func keyboardWillHide() {
        hiddenByKeyboard = false
        applyChromeVisibility()
        applyAktionsleiste()
    }

    private func applyChromeVisibility() {
        guard chromeContainer != nil else { return }
        // Ab 1024 pt zeigt die Web-App ihr Desktop-Layout samt eigener Sidebar.
        let desktopChrome = view.bounds.width >= 1024
        let hidden = !chromeReady || hiddenByWeb || hiddenByKeyboard || desktopChrome
        if hidden == lastAppliedHidden { return }
        lastAppliedHidden = hidden
        // Tabs aus der Web-App: oben bleibt nichts Natives (Menü/Scrim)
        let topHidden = hidden || webTabsMode
        chromeContainer.isUserInteractionEnabled = !topHidden
        scrimView.isHidden = desktopChrome || webTabsMode
        UIView.animate(withDuration: 0.24, delay: 0, options: [.curveEaseOut]) {
            self.chromeContainer.alpha = topHidden ? 0 : 1
            self.chromeContainer.transform = topHidden ? CGAffineTransform(translationX: 0, y: -10) : .identity
            self.scrimView.alpha = topHidden && !self.hiddenByKeyboard ? 0 : 1
        }
        if let overlay = tabOverlay {
            overlay.isUserInteractionEnabled = !hidden
            if #available(iOS 18.0, *), let controller = systemTabController {
                // Apples eigenes Aus- und Einblenden: die Leiste gleitet weg wie beim
                // Öffnen eines Gesprächs (Chat, Dokument) und kommt mit Glas-Animation zurück
                overlay.alpha = 1
                overlay.transform = .identity
                controller.setTabBarHidden(hidden, animated: !UIAccessibility.isReduceMotionEnabled)
            } else {
                UIView.animate(withDuration: 0.24, delay: 0, options: [.curveEaseOut]) {
                    overlay.alpha = hidden ? 0 : 1
                    overlay.transform = hidden ? CGAffineTransform(translationX: 0, y: 12) : .identity
                }
            }
        }
        reportBottomInset()
        layoutMeldung()
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
        // iOS 26: der abgesetzte Kreis (Such-Tab) muss nicht in der Leiste hängen —
        // im Streifen der Leiste gilt jeder Treffer (die Web-App lässt ihn ohnehin frei)
        if !interactive.isHidden, hit !== self, interactive.convert(interactive.bounds, to: self).contains(point) {
            return hit
        }
        return nil
    }
}
