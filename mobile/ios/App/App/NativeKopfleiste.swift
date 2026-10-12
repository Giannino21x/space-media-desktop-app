import UIKit

/// Kopfleiste oben in echtem Liquid Glass (ab 1.0.6, Build 4): Zurück als
/// Glas-Kreis links, bis zu zwei Symbol-Knöpfe rechts in einer Glas-Kapsel —
/// beides in einem UIGlassContainerEffect, so verschmelzen die Formen wie in
/// Apples Apps. Der grosse Titel bleibt in der Web-Seite.
///
///   kopf: {zurueck?: {label}, knoepfe: [{id, symbol, label, aus?}]} | null
///   Tipp: window.__nativeKopf('zurueck' | id)  (NativeChromeViewController)
///   Flag: html[data-native-kopf="1"] — nur ab iOS 26 gesetzt.
///   Gegenstück: src/lib/mobile/native-kopfleiste.ts im Web-Repo.
final class NativeKopfleiste: UIView {

    struct Knopf: Equatable {
        let id: String
        let symbol: String
        let label: String
        let aus: Bool
    }

    struct Inhalt: Equatable {
        /// Beschriftung für VoiceOver («Zurück zu Dokumente»); nil = kein Zurück
        var zurueck: String?
        var knoepfe: [Knopf]
    }

    var onTipp: ((String) -> Void)?
    private(set) var inhalt: Inhalt?

    private let behaelter = UIVisualEffectView(effect: nil)
    private var zurueckKnopf: UIButton?
    private var rechtsGlas: UIVisualEffectView?
    private var hell = false

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
        if #available(iOS 26.0, *) {
            let container = UIGlassContainerEffect()
            container.spacing = 20
            behaelter.effect = container
        }
        behaelter.translatesAutoresizingMaskIntoConstraints = false
        addSubview(behaelter)
        NSLayoutConstraint.activate([
            behaelter.topAnchor.constraint(equalTo: topAnchor),
            behaelter.bottomAnchor.constraint(equalTo: bottomAnchor),
            behaelter.leadingAnchor.constraint(equalTo: leadingAnchor),
            behaelter.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])
    }

    /// Nur Knöpfe nehmen Berührungen an — die Fläche dazwischen gehört der Seite
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let treffer = super.hitTest(point, with: event) else { return nil }
        var knoten: UIView? = treffer
        while let aktuell = knoten {
            if aktuell is UIControl { return treffer }
            if aktuell === self { break }
            knoten = aktuell.superview
        }
        return nil
    }

    /// Neuer Inhalt oder neues Theme: Knöpfe neu bauen
    func setze(_ neu: Inhalt, hell neuHell: Bool) {
        overrideUserInterfaceStyle = neuHell ? .light : .dark
        guard neu != inhalt || neuHell != hell else { return }
        inhalt = neu
        hell = neuHell
        zurueckKnopf?.removeFromSuperview()
        rechtsGlas?.removeFromSuperview()
        zurueckKnopf = nil
        rechtsGlas = nil
        let flaeche = behaelter.contentView

        if let ziel = neu.zurueck {
            let knopf = glasKnopf(symbol: "chevron.backward", gewicht: .semibold)
            knopf.accessibilityLabel = "Zurück zu \(ziel)"
            knopf.addAction(UIAction { [weak self] _ in
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                self?.onTipp?("zurueck")
            }, for: .touchUpInside)
            flaeche.addSubview(knopf)
            NSLayoutConstraint.activate([
                knopf.leadingAnchor.constraint(equalTo: flaeche.leadingAnchor),
                knopf.centerYAnchor.constraint(equalTo: flaeche.centerYAnchor),
                knopf.widthAnchor.constraint(equalToConstant: 44),
                knopf.heightAnchor.constraint(equalToConstant: 44),
            ])
            zurueckKnopf = knopf
        }

        let rechts = Array(neu.knoepfe.prefix(2))
        guard !rechts.isEmpty else { return }
        let glas = UIVisualEffectView(effect: nil)
        glas.translatesAutoresizingMaskIntoConstraints = false
        if #available(iOS 26.0, *) {
            let effekt = UIGlassEffect(style: .regular)
            effekt.isInteractive = true
            glas.effect = effekt
            glas.cornerConfiguration = .capsule()
        } else {
            glas.effect = UIBlurEffect(style: .systemChromeMaterial)
            glas.layer.cornerRadius = 22
            glas.layer.cornerCurve = .continuous
            glas.clipsToBounds = true
        }
        let reihe = UIStackView()
        reihe.axis = .horizontal
        reihe.spacing = 0
        reihe.translatesAutoresizingMaskIntoConstraints = false
        for k in rechts {
            var config = UIButton.Configuration.plain()
            config.image = UIImage(
                systemName: k.symbol,
                withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .medium))
            config.baseForegroundColor = .label
            config.contentInsets = .zero
            let knopf = UIButton(configuration: config)
            knopf.accessibilityLabel = k.label
            knopf.isEnabled = !k.aus
            knopf.translatesAutoresizingMaskIntoConstraints = false
            knopf.widthAnchor.constraint(equalToConstant: 44).isActive = true
            knopf.heightAnchor.constraint(equalToConstant: 44).isActive = true
            let id = k.id
            knopf.addAction(UIAction { [weak self] _ in
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                self?.onTipp?(id)
            }, for: .touchUpInside)
            reihe.addArrangedSubview(knopf)
        }
        // Knöpfe im contentView des Glases, sonst fallen Tipps zur Web-Seite durch
        glas.contentView.addSubview(reihe)
        flaeche.addSubview(glas)
        NSLayoutConstraint.activate([
            reihe.topAnchor.constraint(equalTo: glas.contentView.topAnchor),
            reihe.bottomAnchor.constraint(equalTo: glas.contentView.bottomAnchor),
            reihe.leadingAnchor.constraint(equalTo: glas.contentView.leadingAnchor, constant: rechts.count > 1 ? 4 : 0),
            reihe.trailingAnchor.constraint(equalTo: glas.contentView.trailingAnchor, constant: rechts.count > 1 ? -4 : 0),
            glas.trailingAnchor.constraint(equalTo: flaeche.trailingAnchor),
            glas.centerYAnchor.constraint(equalTo: flaeche.centerYAnchor),
            glas.heightAnchor.constraint(equalToConstant: 44),
        ])
        rechtsGlas = glas
    }

    /// Ein runder Glas-Knopf mit SF Symbol (iOS 26: Apples .glass())
    private func glasKnopf(symbol: String, gewicht: UIImage.SymbolWeight) -> UIButton {
        var config: UIButton.Configuration
        if #available(iOS 26.0, *) {
            config = .glass()
        } else {
            config = .gray()
        }
        config.cornerStyle = .capsule
        config.image = UIImage(
            systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: gewicht))
        config.baseForegroundColor = .label
        config.contentInsets = .zero
        let knopf = UIButton(configuration: config)
        knopf.translatesAutoresizingMaskIntoConstraints = false
        return knopf
    }
}
