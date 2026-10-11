import ActivityKit
import Foundation

/// Live Activity einer laufenden Aufnahme (Sitzung, Diktat) — gehört zu BEIDEN
/// Targets: App (startet/aktualisiert/beendet) und SpaceLiveActivity (zeichnet
/// Dynamic Island + Sperrbildschirm).
@available(iOS 16.2, *)
struct AufnahmeAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// "laeuft" | "pausiert"
        var status: String
        /// Laufend: ab hier zählt die Uhr (Pausen schon abgezogen) — die Uhr
        /// läuft nativ, die Web-App meldet nur Zustandswechsel.
        var start: Date
        /// Pausiert: eingefrorene Dauer in Sekunden
        var dauerSek: Int

        var laeuft: Bool { status != "pausiert" }
    }

    /// «Sitzung», «Diktat»
    var titel: String
}

enum AufnahmeLink {
    /// Tipp auf «Stopp» öffnet die App; AppDelegate leitet an die Web-App weiter.
    static let stopp = URL(string: "spacemedia://aufnahme/stopp")!
    /// Tipp auf die Insel / den Sperrbildschirm: zurück zur Aufnahme.
    static let oeffnen = URL(string: "spacemedia://aufnahme")!
}
