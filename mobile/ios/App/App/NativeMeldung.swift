import UIKit

/// Meldung (Toast) in echtem Liquid Glass (ab 1.0.6, Build 3): eine Glas-Kapsel
/// 12 pt über der Tab-Leiste bzw. Aktionsleiste — Komponente «Meldung (Toast)» im
/// Design-Canvas. Die Web-App behält sonner als Quelle (Dauer, Schliessen,
/// Promise-Toasts) und spiegelt nur die vorderste Meldung hierher.
///
///   Web  -> Nativ: webkit.messageHandlers.meldung.postMessage(
///                  {meldung: {id, typ, titel, text?, aktion?, hell} | null})
///                  typ: "erfolg" | "fehler" | "info" | "warnung" | "laden" | "normal"
///   Nativ -> Web:  window.__nativeMeldung(id, 'gezeigt' | 'aktion' | 'zu')
///   Flag:          html[data-native-meldung="1"]
///   Gegenstück:    src/lib/mobile/native-meldung.ts im Web-Repo.
/// Unter iOS 26: Material statt Glas.
final class NativeMeldung: UIView {

    struct Inhalt: Equatable {
        let id: String
        let typ: String
        let titel: String
        let text: String?
        let aktion: String?
        let hell: Bool
    }

    /// Antwort an die Web-App: (id, "gezeigt" | "aktion" | "zu")
    var onAntwort: ((String, String) -> Void)?
    private(set) var inhalt: Inhalt?
    private(set) var sichtbar = false

    private let glas = UIVisualEffectView(effect: nil)
    private let zeile = UIStackView()
    private let symbol = UIImageView()
    private let kreisel = UIActivityIndicatorView(style: .medium)
    private let label = UILabel()
    private let knopf = UIButton(type: .system)
    private var knopfRand: NSLayoutConstraint?
    private var textRand: NSLayoutConstraint?

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
        isHidden = true
        alpha = 0

        glas.translatesAutoresizingMaskIntoConstraints = false
        if #available(iOS 26.0, *) {
            glas.cornerConfiguration = .capsule()
        } else {
            glas.layer.cornerRadius = 26
            glas.layer.cornerCurve = .continuous
            glas.clipsToBounds = true
        }
        addSubview(glas)

        symbol.translatesAutoresizingMaskIntoConstraints = false
        symbol.contentMode = .scaleAspectFit
        symbol.setContentHuggingPriority(.required, for: .horizontal)
        kreisel.hidesWhenStopped = true

        label.numberOfLines = 1
        label.lineBreakMode = .byTruncatingTail
        label.adjustsFontForContentSizeCategory = true
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        knopf.setContentHuggingPriority(.required, for: .horizontal)
        knopf.setContentCompressionResistancePriority(.required, for: .horizontal)
        knopf.addAction(UIAction { [weak self] _ in
            guard let self, let id = self.inhalt?.id else { return }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            self.onAntwort?(id, "aktion")
        }, for: .touchUpInside)

        zeile.axis = .horizontal
        zeile.alignment = .center
        zeile.spacing = 10
        zeile.translatesAutoresizingMaskIntoConstraints = false
        zeile.addArrangedSubview(symbol)
        zeile.addArrangedSubview(kreisel)
        zeile.addArrangedSubview(label)
        zeile.addArrangedSubview(knopf)
        glas.contentView.addSubview(zeile)

        let ohneKnopf = zeile.trailingAnchor.constraint(equalTo: glas.contentView.trailingAnchor, constant: -16)
        let mitKnopf = zeile.trailingAnchor.constraint(equalTo: glas.contentView.trailingAnchor, constant: -4)
        textRand = ohneKnopf
        knopfRand = mitKnopf
        NSLayoutConstraint.activate([
            glas.topAnchor.constraint(equalTo: topAnchor),
            glas.bottomAnchor.constraint(equalTo: bottomAnchor),
            glas.leadingAnchor.constraint(equalTo: leadingAnchor),
            glas.trailingAnchor.constraint(equalTo: trailingAnchor),
            glas.heightAnchor.constraint(greaterThanOrEqualToConstant: 52),
            zeile.leadingAnchor.constraint(equalTo: glas.contentView.leadingAnchor, constant: 14),
            zeile.topAnchor.constraint(greaterThanOrEqualTo: glas.contentView.topAnchor, constant: 4),
            zeile.bottomAnchor.constraint(lessThanOrEqualTo: glas.contentView.bottomAnchor, constant: -4),
            zeile.centerYAnchor.constraint(equalTo: glas.contentView.centerYAnchor),
            symbol.widthAnchor.constraint(equalToConstant: 22),
            symbol.heightAnchor.constraint(equalToConstant: 22),
            knopf.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            ohneKnopf,
        ])

        // Nach unten wischen schliesst (kein Kreuz — Komponente «Meldung»)
        addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(gewischt(_:))))
    }

    /// Neue Meldung zeigen (oder die gezeigte aktualisieren, z. B. laden -> erfolg)
    func zeige(_ neu: Inhalt, akzent: UIColor) {
        let istNeu = neu.id != inhalt?.id || !sichtbar
        let typWechsel = neu.typ != inhalt?.typ
        inhalt = neu
        overrideUserInterfaceStyle = neu.hell ? .light : .dark
        befuellen(neu, akzent: akzent)

        if istNeu || typWechsel {
            switch neu.typ {
            case "erfolg": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "fehler": UINotificationFeedbackGenerator().notificationOccurred(.error)
            case "warnung": UINotificationFeedbackGenerator().notificationOccurred(.warning)
            default: break
            }
            UIAccessibility.post(notification: .announcement, argument: label.accessibilityLabel)
        }
        guard !sichtbar else { return }
        sichtbar = true
        isHidden = false
        let ruhig = UIAccessibility.isReduceMotionEnabled
        transform = ruhig ? .identity : CGAffineTransform(translationX: 0, y: 24)
        UIView.animate(
            withDuration: ruhig ? 0.2 : 0.42, delay: 0, usingSpringWithDamping: 0.88,
            initialSpringVelocity: 0, options: [.allowUserInteraction, .beginFromCurrentState]
        ) {
            self.alpha = 1
            self.transform = .identity
            self.materialAn()
        }
    }

    /// Meldung weg (Web hat sie geschlossen oder es gibt keine mehr)
    func verstecke() {
        guard sichtbar else { return }
        sichtbar = false
        let ruhig = UIAccessibility.isReduceMotionEnabled
        UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseIn, .beginFromCurrentState]) {
            self.alpha = 0
            if !ruhig { self.transform = CGAffineTransform(translationX: 0, y: 16) }
            self.materialAus()
        } completion: { _ in
            if !self.sichtbar {
                self.isHidden = true
                self.transform = .identity
            }
        }
    }

    // MARK: - Inhalt

    private func befuellen(_ neu: Inhalt, akzent: UIColor) {
        let groesse = UIFontMetrics(forTextStyle: .subheadline)
        let fett = groesse.scaledFont(for: .systemFont(ofSize: 15, weight: .semibold))
        let normal = groesse.scaledFont(for: .systemFont(ofSize: 15, weight: .regular))
        let text = NSMutableAttributedString(
            string: neu.titel, attributes: [.font: fett, .foregroundColor: UIColor.label])
        if let zusatz = neu.text, !zusatz.isEmpty {
            text.append(NSAttributedString(
                string: " · " + zusatz, attributes: [.font: normal, .foregroundColor: UIColor.secondaryLabel]))
        }
        label.attributedText = text
        label.accessibilityLabel = [neu.titel, neu.text].compactMap { $0 }.joined(separator: ", ")

        if neu.typ == "laden" {
            symbol.isHidden = true
            kreisel.startAnimating()
        } else {
            kreisel.stopAnimating()
            let (name, farbe) = Self.symbol(fuer: neu.typ, akzent: akzent)
            symbol.image = name.flatMap {
                UIImage(systemName: $0, withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold))
            }
            symbol.tintColor = farbe
            symbol.isHidden = symbol.image == nil
        }

        if let aktion = neu.aktion, !aktion.isEmpty {
            var config = UIButton.Configuration.plain()
            config.title = aktion
            config.baseForegroundColor = akzent
            config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12)
            config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attribute in
                var neu = attribute
                neu.font = fett
                return neu
            }
            knopf.configuration = config
            knopf.accessibilityLabel = aktion
            knopf.isHidden = false
            textRand?.isActive = false
            knopfRand?.isActive = true
        } else {
            knopf.isHidden = true
            knopfRand?.isActive = false
            textRand?.isActive = true
        }
    }

    private static func symbol(fuer typ: String, akzent: UIColor) -> (String?, UIColor) {
        switch typ {
        case "erfolg": return ("checkmark.circle.fill", .systemGreen)
        case "fehler": return ("exclamationmark.circle.fill", .systemRed)
        case "warnung": return ("exclamationmark.triangle.fill", .systemOrange)
        case "info": return ("info.circle.fill", akzent)
        default: return (nil, .label)
        }
    }

    // MARK: - Material

    private func materialAn() {
        if #available(iOS 26.0, *) {
            let effekt = UIGlassEffect(style: .regular)
            effekt.isInteractive = true
            glas.effect = effekt
        } else {
            glas.effect = UIBlurEffect(style: .systemChromeMaterial)
        }
    }

    private func materialAus() {
        if #available(iOS 26.0, *) {
            glas.effect = nil
        }
    }

    // MARK: - Berührung

    @objc private func gewischt(_ geste: UIPanGestureRecognizer) {
        let weg = geste.translation(in: self).y
        switch geste.state {
        case .changed:
            transform = CGAffineTransform(translationX: 0, y: max(0, weg))
        case .ended, .cancelled:
            if weg > 24 || geste.velocity(in: self).y > 400, let id = inhalt?.id {
                onAntwort?(id, "zu")
                verstecke()
            } else {
                UIView.animate(withDuration: 0.2) { self.transform = .identity }
            }
        default:
            break
        }
    }

    /// Nur die Kapsel selbst nimmt Berührungen an
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard sichtbar, !isHidden else { return nil }
        return super.hitTest(point, with: event)
    }
}
