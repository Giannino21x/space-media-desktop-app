import ActivityKit
import AppIntents
import Foundation

/// Live Activity einer Aufnahme (Sitzung, Diktat) — gehört zu BEIDEN
/// Targets: App (startet/aktualisiert/beendet) und SpaceLiveActivity (zeichnet
/// Dynamic Island + Sperrbildschirm).
///
/// Ab 1.0.6 (Mobile 2.0, Canvas «Sys-Island»): nach der Aufnahme
/// «Steno schreibt», dann «Protokoll bereit» (15 Minuten, Tipp öffnet das
/// Dokument). Die Web-App meldet das nur, wenn die Hülle es kennt
/// (html[data-native-insel="2"]).
@available(iOS 16.2, *)
struct AufnahmeAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// "laeuft" | "pausiert" | "schreibt" | "bereit"
        var status: String
        /// Laufend: ab hier zählt die Uhr (Pausen schon abgezogen) — die Uhr
        /// läuft nativ, die Web-App meldet nur Zustandswechsel.
        var start: Date
        /// Pausiert: eingefrorene Dauer in Sekunden
        var dauerSek: Int
        /// Bereit: Pfad in der Web-App (/sitzungen/<id>) — Tipp öffnet ihn
        var pfad: String? = nil

        var laeuft: Bool { status == "laeuft" }
        var aufnahme: Bool { status == "laeuft" || status == "pausiert" }
    }

    /// «Diktat Bausitzung 7», «Sitzung»
    var titel: String
}

enum AufnahmeLink {
    /// Tipp auf «Fertig» (ältere iOS ohne App Intent) öffnet die App; AppDelegate leitet an die Web-App weiter.
    static let stopp = URL(string: "spacemedia://aufnahme/stopp")!
    /// Tipp auf die Insel / den Sperrbildschirm: zurück zur Aufnahme.
    static let oeffnen = URL(string: "spacemedia://aufnahme")!

    /// Tipp auf «Protokoll bereit»: dieses Dokument in der App öffnen.
    static func dokument(_ pfad: String?) -> URL {
        guard let pfad, pfad.hasPrefix("/"), !pfad.hasPrefix("//"),
              var teile = URLComponents(string: "spacemedia://oeffne") else { return oeffnen }
        teile.queryItems = [URLQueryItem(name: "pfad", value: pfad)]
        return teile.url ?? oeffnen
    }
}

/// «Fertig» in der Insel und auf dem Sperrbildschirm (ab iOS 17): beendet die
/// Aufnahme direkt, ohne die App zu öffnen. Läuft im Prozess der App — die
/// Mitteilung landet bei LiveActivityBridge, die window.__nativeAufnahme('stopp')
/// in der Web-App ruft (Hintergrund-Audio hält die App wach).
@available(iOS 17.0, *)
struct AufnahmeFertigIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Aufnahme fertig"

    init() {}

    func perform() async throws -> some IntentResult {
        await MainActor.run {
            NotificationCenter.default.post(name: Notification.Name("ch.spacemedia.aufnahme.stopp"), object: nil)
        }
        return .result()
    }
}
