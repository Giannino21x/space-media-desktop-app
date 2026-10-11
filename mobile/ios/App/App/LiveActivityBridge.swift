import ActivityKit
import Foundation
import WebKit

/// Brücke Web-App → Live Activity (Dynamic Island + Sperrbildschirm) für
/// laufende Aufnahmen. Gegenstück: `src/lib/mobile/live-activity.ts`.
///
///   Web -> Nativ: webkit.messageHandlers.liveActivity.postMessage(
///                 {action: "aufnahme", status: "laeuft"|"pausiert", titel, startMs?, dauerSek?}
///                 | {action: "ende"})
///   Nativ -> Web: window.__nativeAufnahme('stopp') — nach Tipp auf «Stopp»
///                 (spacemedia://aufnahme/stopp, AppDelegate → Notification).
///
/// Unter iOS 16.2 oder mit abgeschalteten Live Activities ein stiller No-Op.
final class LiveActivityBridge: NSObject, WKScriptMessageHandler {
    static let stoppNotification = Notification.Name("ch.spacemedia.aufnahme.stopp")

    private weak var webView: WKWebView?
    /// Activity<AufnahmeAttributes> — als Any, weil die Klasse auch unter iOS 15 lebt.
    private var aktivitaet: Any?

    func attach(to webView: WKWebView) {
        self.webView = webView
        webView.configuration.userContentController.add(self, name: "liveActivity")
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

    // MARK: - ActivityKit

    @available(iOS 16.2, *)
    @MainActor
    private func aufnahme(_ body: [String: Any]) async {
        let status = (body["status"] as? String) == "pausiert" ? "pausiert" : "laeuft"
        let titel = (body["titel"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Aufnahme"
        let start = (body["startMs"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
        let dauer = (body["dauerSek"] as? Double).map { Int($0) } ?? 0
        let state = AufnahmeAttributes.ContentState(status: status, start: start, dauerSek: dauer)
        let content = ActivityContent(state: state, staleDate: nil)

        if let laufend = aktivitaet as? Activity<AufnahmeAttributes>, laufend.activityState == .active {
            await laufend.update(content)
            return
        }
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
