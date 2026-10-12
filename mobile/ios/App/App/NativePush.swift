import UIKit
import WebKit
import UserNotifications

/// Nativer Push (APNs) für die Web-App (ab 1.0.6, Build 5). Die Web-Seite fragt
/// erst nach dem ersten Versand um Erlaubnis (lib/mobile/mitteilungen.ts), nie
/// beim Start; der Server schickt über APNs (lib/notifications/apns.ts) mit
/// `pfad` in der Nutzlast, ein Tipp öffnet genau diese Seite.
///
///   Web  -> Nativ: webkit.messageHandlers.push.postMessage({art: 'status' | 'erlauben' | 'einstellungen' | 'token'})
///   Nativ -> Web:  window.__nativePushStatus('an' | 'aus' | 'gesperrt')
///                  window.__nativePushToken(hex, 'production')
///   Flag:          html[data-native-push="1"]
///   Gegenstück:    src/lib/mobile/mitteilungen.ts, src/lib/mobile/native-push.ts
final class NativePush: NSObject, WKScriptMessageHandler, UNUserNotificationCenterDelegate {

    static let shared = NativePush()
    /// AppDelegate meldet das Gerätetoken (hex) über diese Notification
    static let tokenNotification = Notification.Name("ch.spacemedia.push.token")

    private weak var webView: WKWebView?
    private var token: String?

    /// Am WebView anmelden: Flag, Kanal, Delegate; Token auffrischen, wenn schon erlaubt
    func attach(to webView: WKWebView) {
        self.webView = webView
        let flag = WKUserScript(
            source: "document.documentElement.dataset.nativePush = '1'",
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true)
        webView.configuration.userContentController.addUserScript(flag)
        webView.configuration.userContentController.add(self, name: "push")
        // Capacitor setzt beim Start seinen eigenen Delegate — danach wieder unseren
        UNUserNotificationCenter.current().delegate = self
        NotificationCenter.default.addObserver(
            self, selector: #selector(tokenErhalten(_:)), name: Self.tokenNotification, object: nil)
        UNUserNotificationCenter.current().getNotificationSettings { einstellungen in
            guard Self.istErlaubt(einstellungen.authorizationStatus) else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    // MARK: - Web -> Nativ

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "push", let body = message.body as? [String: Any], let art = body["art"] as? String else { return }
        switch art {
        case "status":
            meldeStatus()
        case "erlauben":
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { erlaubt, _ in
                DispatchQueue.main.async {
                    if erlaubt { UIApplication.shared.registerForRemoteNotifications() }
                    self.meldeStatus()
                }
            }
        case "einstellungen":
            let ziel: String
            if #available(iOS 16.0, *) {
                ziel = UIApplication.openNotificationSettingsURLString
            } else {
                ziel = UIApplication.openSettingsURLString
            }
            if let url = URL(string: ziel) { UIApplication.shared.open(url) }
        case "token":
            meldeToken()
        default:
            break
        }
    }

    private static func istErlaubt(_ status: UNAuthorizationStatus) -> Bool {
        switch status {
        case .authorized, .provisional, .ephemeral: return true
        default: return false
        }
    }

    private func meldeStatus() {
        UNUserNotificationCenter.current().getNotificationSettings { einstellungen in
            let status: String
            if Self.istErlaubt(einstellungen.authorizationStatus) {
                status = "an"
            } else if einstellungen.authorizationStatus == .denied {
                status = "gesperrt"
            } else {
                status = "aus"
            }
            DispatchQueue.main.async {
                self.js("window.__nativePushStatus && window.__nativePushStatus('\(status)')")
            }
        }
    }

    /// Token nur, wenn eines da ist (es kommt erst nach der Erlaubnis von Apple)
    private func meldeToken() {
        guard let token else { return }
        js("window.__nativePushToken && window.__nativePushToken('\(token)','production')")
    }

    @objc private func tokenErhalten(_ notification: Notification) {
        guard let hex = notification.userInfo?["token"] as? String,
              hex.range(of: "^[0-9a-f]{64,200}$", options: .regularExpression) != nil else { return }
        token = hex
        DispatchQueue.main.async { self.meldeToken() }
    }

    private func js(_ skript: String) {
        webView?.evaluateJavaScript(skript, completionHandler: nil)
    }

    // MARK: - Mitteilungen

    /// Auch bei offener App als Banner zeigen
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    /// Tipp auf die Mitteilung: die Seite aus `pfad` öffnen
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if let pfad = response.notification.request.content.userInfo["pfad"] as? String {
            Self.oeffne(pfad)
        }
        completionHandler()
    }

    /// Nur eigene Pfade; der Controller öffnet sie (auch nach einem Kaltstart)
    static func oeffne(_ pfad: String) {
        guard AppDelegate.istEigenerPfad(pfad) else { return }
        AppDelegate.wartenderPfad = pfad
        NotificationCenter.default.post(name: AppDelegate.oeffnePfad, object: nil, userInfo: ["pfad": pfad])
    }
}
