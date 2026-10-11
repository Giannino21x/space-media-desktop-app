import ActivityKit
import Foundation
import UIKit
import WebKit

/// Brücke Web-App → Live Activity (Dynamic Island + Sperrbildschirm) für
/// laufende Aufnahmen. Gegenstück: `src/lib/mobile/live-activity.ts`.
///
///   Web -> Nativ: webkit.messageHandlers.liveActivity.postMessage(
///                 {action: "aufnahme", status: "laeuft"|"pausiert"|"schreibt"|"bereit",
///                  titel, startMs?, dauerSek?, pfad?}
///                 | {action: "ende"})
///   Ab 1.0.6: «schreibt» (Steno schreibt nach der Aufnahme) und «bereit»
///   (Protokoll bereit, bleibt 15 Minuten, Tipp öffnet `pfad`). Die Hülle
///   meldet das mit html[data-native-insel="2"].
///   Nativ -> Web: window.__nativeAufnahme('stopp') — nach Tipp auf «Stopp»
///                 (spacemedia://aufnahme/stopp, AppDelegate → Notification).
///
/// Unter iOS 16.2 oder mit abgeschalteten Live Activities ein stiller No-Op.
final class LiveActivityBridge: NSObject, WKScriptMessageHandler {
    static let stoppNotification = Notification.Name("ch.spacemedia.aufnahme.stopp")

    private weak var webView: WKWebView?
    /// Activity<AufnahmeAttributes> — als Any, weil die Klasse auch unter iOS 15 lebt.
    private var aktivitaet: Any?

    /// «Protokoll bereit» endet nach dieser Zeit (Design: 15 Minuten stehen lassen)
    private static let bereitDauer: TimeInterval = 15 * 60
    private var bereitSeit: Date?

    func attach(to webView: WKWebView) {
        self.webView = webView
        webView.configuration.userContentController.add(self, name: "liveActivity")
        // Web-App: diese Hülle kennt «schreibt» und «bereit» (ab 1.0.6)
        webView.configuration.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.dataset.nativeInsel = '2'",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        NotificationCenter.default.addObserver(
            self, selector: #selector(appAktiv), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(stoppAngetippt), name: Self.stoppNotification, object: nil)
        // App wurde während einer Aufnahme beendet: die Aufnahme ist weg, die Insel darf nicht bleiben.
        if #available(iOS 16.2, *) {
            Task { await Self.alleBeenden() }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard #available(iOS 16.2, *),
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        Task { @MainActor in
            switch action {
            case "aufnahme": await self.aufnahme(body)
            case "ende": await self.ende()
            default: break
            }
        }
    }

    @objc private func stoppAngetippt() {
        webView?.evaluateJavaScript("window.__nativeAufnahme && window.__nativeAufnahme('stopp')")
    }

    /// Zurück in der App: «Protokoll bereit» länger als 15 Minuten → beenden
    @objc private func appAktiv() {
        guard let seit = bereitSeit, Date().timeIntervalSince(seit) >= Self.bereitDauer else { return }
        bereitSeit = nil
        if #available(iOS 16.2, *) {
            Task { @MainActor in await self.ende() }
        }
    }

    // MARK: - ActivityKit

    @available(iOS 16.2, *)
    @MainActor
    private func aufnahme(_ body: [String: Any]) async {
        let bekannt: Set<String> = ["laeuft", "pausiert", "schreibt", "bereit"]
        let roh = body["status"] as? String ?? "laeuft"
        let status = bekannt.contains(roh) ? roh : "laeuft"
        let titel = (body["titel"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Aufnahme"
        let start = (body["startMs"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
        let dauer = (body["dauerSek"] as? Double).map { Int($0) } ?? 0
        let pfad = body["pfad"] as? String
        let state = AufnahmeAttributes.ContentState(status: status, start: start, dauerSek: dauer, pfad: pfad)
        let bereit = status == "bereit"
        let content = ActivityContent(state: state, staleDate: bereit ? Date().addingTimeInterval(Self.bereitDauer) : nil)

        if bereit {
            bereitSeit = Date()
            // Läuft die App weiter (Hintergrund-Audio, Vordergrund), endet die Insel pünktlich;
            // sonst beim nächsten Öffnen (appAktiv) und spätestens nach staleDate grau.
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(Self.bereitDauer * 1_000_000_000))
                guard let self, let seit = self.bereitSeit, Date().timeIntervalSince(seit) >= Self.bereitDauer else { return }
                self.bereitSeit = nil
                await self.ende()
            }
        } else {
            bereitSeit = nil
        }

        if let laufend = aktivitaet as? Activity<AufnahmeAttributes>, laufend.activityState == .active {
            await laufend.update(content)
            return
        }
        // «schreibt»/«bereit» ohne laufende Insel (z. B. App neu gestartet): nichts Neues anfangen
        if status == "schreibt" || bereit { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            aktivitaet = try Activity.request(
                attributes: AufnahmeAttributes(titel: titel),
                content: content,
                pushType: nil
            )
        } catch {
            NSLog("[LiveActivity] Start fehlgeschlagen: \(error.localizedDescription)")
        }
    }

    @available(iOS 16.2, *)
    @MainActor
    private func ende() async {
        aktivitaet = nil
        await Self.alleBeenden()
    }

    @available(iOS 16.2, *)
    private static func alleBeenden() async {
        for activity in Activity<AufnahmeAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
