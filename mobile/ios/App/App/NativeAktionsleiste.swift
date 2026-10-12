import UIKit

/// Aktionsleiste unten in echtem Liquid Glass (ab 1.0.6): Seiten ohne Tab-Leiste
/// (das Dokument mit «Ändern» und «Freigeben und senden») melden ihre Knöpfe im
/// Feld `aktionen` der nativeChrome-Meldung; die Hülle zeichnet sie wie iOS 26 —
/// schwebende Glas-Kapseln über einem weichen Rand, darüber eine kleine Zeile.
/// Ein Tipp geht über window.__nativeAktion(id) zurück (NativeChromeViewController).
/// Unter iOS 26: Material statt Glas, gefüllte Knöpfe.
///
///   aktionen: {text?, knoepfe: [{id, label, stil: "haupt"|"neben", aus?}], akzent?, tinte?} | null
///   Gegenstück: src/lib/mobile/native-aktionen.ts im Web-Repo.
final class NativeAktionsleiste: UIView {

    struct Knopf: Equatable {
        let id: String
        let label: String
        let haupt: Bool
        let aus: Bool
    }

    struct Inhalt: Equatable {
        var text: String?
        var knoepfe: [Knopf]
        /// Hauptknopf: Glas-Tönung und Schrift (Web: --cta-bg, --cta-text)
        var akzent: UIColor?
        var tinte: UIColor?
    }

    /// Tipp auf einen Knopf (Kennung aus der Web-App)
    var onTipp: ((String) -> Void)?
    private(set) var inhalt: Inhalt?

    private let rand = CAGradientLayer()
    private var material: UIVisualEffectView?
    private let stapel = UIStackView()
    private let zeile = UIStackView()
    private let label = UILabel()
    private var knoepfe: [UIButton] = []
    private var grund = UIColor.black

    override init(frame: CGRect) {
        super.init(frame: frame)
        aufbauen()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        aufbauen()
    }

    private func aufbauen() {
        backgroundColor = .clear
        // Weicher Rand wie die Scroll-Kante in iOS 26: der Inhalt blendet unter den
        // Knöpfen aus, die Zeile darüber bleibt lesbar (auch über dem hellen Papier)
        if #available(iOS 26.0, *) {
            layer.insertSublayer(rand, at: 0)
        } else {
            let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
            blur.translatesAutoresizingMaskIntoConstraints = false
            blur.isUserInteractionEnabled = false
            addSubview(blur)
            NSLayoutConstraint.activate([
                blur.topAnchor.constraint(equalTo: topAnchor),
                blur.bottomAnchor.constraint(equalTo: bottomAnchor),
                blur.leadingAnchor.constraint(equalTo: leadingAnchor),
                blur.trailingAnchor.constraint(equalTo: trailingAnchor),
            ])
            material = blur
        }

        label.font = UIFont.preferredFont(forTextStyle: .footnote)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = .secondaryLabel
        label.textAlignment = .center
        label.numberOfLines = 2

        zeile.axis = .horizontal
        zeile.spacing = 10
        zeile.alignment = .fill
        zeile.distribution = .fill

        stapel.axis = .vertical
        stapel.spacing = 10
        stapel.alignment = .fill
        stapel.translatesAutoresizingMaskIntoConstraints = false
        stapel.addArrangedSubview(label)
        stapel.addArrangedSubview(zeile)
        addSubview(stapel)

        // So tief wie erlaubt: über dem Home-Indikator, sonst 12 pt Rand (wie Apples Tab-Leiste)
        let tief = stapel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12)
        tief.priority = .defaultLow
        NSLayoutConstraint.activate([
            stapel.topAnchor.constraint(equalTo: topAnchor, constant: 26),
            stapel.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 16),
            stapel.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -16),
            stapel.bottomAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.bottomAnchor, constant: -4),
            stapel.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor, constant: -12),
            tief,
        ])
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        rand.frame = bounds
        CATransaction.commit()
    }

    /// Leere Fläche (Rand, Zwischenräume) lässt Berührungen zur Seite durch
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let treffer = super.hitTest(point, with: event)
        return treffer === self || treffer === stapel || treffer === zeile || treffer === label ? nil : treffer
    }

    /// Neuer Inhalt oder neues Theme: Knöpfe neu bauen
    func setze(_ neu: Inhalt, hell: Bool, grund farbe: UIColor) {
        overrideUserInterfaceStyle = hell ? .light : .dark
        grund = farbe
        rand.colors = [
            farbe.withAlphaComponent(0).cgColor,
            farbe.withAlphaComponent(0.86).cgColor,
            farbe.withAlphaComponent(0.86).cgColor,
        ]
        rand.locations = [0, 0.4, 1]
        guard neu != inhalt else { return }
        inhalt = neu

        label.text = neu.text
        label.isHidden = (neu.text ?? "").isEmpty
        knoepfe.forEach { $0.removeFromSuperview() }
        knoepfe = neu.knoepfe.map { knopf(fuer: $0, inhalt: neu) }
        knoepfe.forEach { zeile.addArrangedSubview($0) }
    }

    private func knopf(fuer k: Knopf, inhalt: Inhalt) -> UIButton {
        var config: UIButton.Configuration
        if #available(iOS 26.0, *) {
            config = k.haupt ? .prominentGlass() : .glass()
        } else {
            config = k.haupt ? .filled() : .gray()
            if k.haupt, let akzent = inhalt.akzent { config.baseBackgroundColor = akzent }
        }
        config.cornerStyle = .capsule
        config.title = k.label
        config.titleLineBreakMode = .byTruncatingTail
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attribute in
            var neu = attribute
            neu.font = UIFont.preferredFont(forTextStyle: .headline)
            return neu
        }
        config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 22, bottom: 0, trailing: 22)
        if k.haupt {
            config.baseForegroundColor = inhalt.tinte ?? .white
        } else {
            config.baseForegroundColor = .label
        }
        let button = UIButton(configuration: config)
        // Das Glas des Hauptknopfs nimmt die Tönung aus tintColor (Akzent des Produkts)
        if k.haupt, let akzent = inhalt.akzent { button.tintColor = akzent }
        button.isEnabled = !k.aus
        button.accessibilityLabel = k.label
        button.heightAnchor.constraint(equalToConstant: 50).isActive = true
        // Nebenknopf so schmal wie seine Beschriftung, der Hauptknopf nimmt den Rest
        button.setContentHuggingPriority(k.haupt ? .defaultLow : .required, for: .horizontal)
        button.setContentCompressionResistancePriority(k.haupt ? .defaultLow : .required, for: .horizontal)
        let id = k.id
        button.addAction(UIAction { [weak self] _ in
            UIImpactFeedbackGenerator(style: k.haupt ? .medium : .light).impactOccurred()
            self?.onTipp?(id)
        }, for: .touchUpInside)
        return button
    }
}
