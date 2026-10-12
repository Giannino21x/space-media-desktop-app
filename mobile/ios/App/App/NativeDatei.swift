import UIKit
import WebKit
import QuickLook
import UniformTypeIdentifiers
import Capacitor

/// Dateien (PDF, Word, Tabellen …) in der Hülle ansehen statt sie ins App-Fenster
/// zu laden (ab 1.0.6 Build 25). Ein Link auf einen PDF-Export lud bisher die
/// Datei an Stelle der Web-App: sie lag unter Statusleiste und Zurück-Knopf, und
/// die Glas-Knöpfe fanden keine Seite mehr, die ihre Tipps annimmt — man kam
/// nicht mehr weg. Jetzt holt die Hülle die Datei mit den Cookies der Web-App und
/// zeigt sie in Apples QuickLook (Fertig, Teilen, Drucken).
///
///   Abfangen: NativeDateiNavigation (unten) — eine Navigation des Hauptfensters
///             oder ein neues Fenster (target=_blank) zu einer Datei-Adresse der
///             Web-App (/api/…/export, /file, /datei, /download, /attachment)
///             oder zu einer Adresse mit Dokument-Endung. Die Web-App braucht
///             dafür nichts: ihre Links bleiben, wie sie sind.
final class NativeDatei: NSObject, QLPreviewControllerDataSource {

    private weak var webView: WKWebView?
    private weak var anzeiger: UIViewController?
    private var datei: URL?
    private var laeuft = false
    private var rad: UIActivityIndicatorView?

    func attach(to webView: WKWebView, anzeiger: UIViewController) {
        self.webView = webView
        self.anzeiger = anzeiger
    }

    // MARK: - Was ist eine Datei?

    private static let endungen: Set<String> = [
        "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "rtf",
        "pages", "numbers", "key", "zip",
    ]
    /// Pfadteile der Datei-Routen der Web-App (src/app/api/**/route.ts)
    private static let dateiPfade: Set<String> = ["export", "file", "datei", "download", "attachment"]

    /// Seiten der Web-App liegen nie unter /api/ — dort nur Datei-Routen, nicht
    /// alles (OAuth-Routen wie /api/mcp/connect leiten weiter und bleiben unberührt)
    static func istDatei(_ url: URL, appHost: String?) -> Bool {
        if endungen.contains(url.pathExtension.lowercased()) { return true }
        guard let host = url.host, host == appHost else { return false }
        let teile = url.path.split(separator: "/").map { $0.lowercased() }
        guard teile.first == "api" else { return false }
        return teile.contains { dateiPfade.contains($0) }
    }

    // MARK: - Laden und zeigen

    func oeffne(_ url: URL) {
        guard !laeuft, let webView = webView else { return }
        laeuft = true
        zeigeRad(true)
        // Die Datei-Routen prüfen die Anmeldung: Cookies der Web-App mitgeben
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
            let config = URLSessionConfiguration.ephemeral
            let speicher = config.httpCookieStorage
            cookies.forEach { speicher?.setCookie($0) }
            config.httpCookieStorage = speicher
            let session = URLSession(configuration: config)
            session.downloadTask(with: url) { ort, antwort, fehler in
                // Die geladene Datei verschwindet nach diesem Block: sofort ablegen
                let ziel = fehler == nil ? Self.ablegen(ort, antwort: antwort, url: url) : nil
                session.finishTasksAndInvalidate()
                DispatchQueue.main.async {
                    self.laeuft = false
                    self.zeigeRad(false)
                    if let ziel { self.zeige(ziel) } else { self.meldeFehler() }
                }
            }.resume()
        }
    }

    private static func ablegen(_ ort: URL?, antwort: URLResponse?, url: URL) -> URL? {
        guard let ort, let http = antwort as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        // HTML statt Datei = Anmeldeseite oder Fehlerseite
        if let mime = http.mimeType, mime.hasPrefix("text/html") { return nil }
        var name = (http.suggestedFilename ?? url.lastPathComponent).replacingOccurrences(of: "/", with: "-")
        if name.isEmpty { name = "Datei" }
        if (name as NSString).pathExtension.isEmpty,
           let mime = http.mimeType,
           let endung = UTType(mimeType: mime)?.preferredFilenameExtension {
            name += "." + endung
        }
        // Nur die zuletzt geöffnete Datei behalten
        let ordner = FileManager.default.temporaryDirectory.appendingPathComponent("Dateien", isDirectory: true)
        try? FileManager.default.removeItem(at: ordner)
        do {
            try FileManager.default.createDirectory(at: ordner, withIntermediateDirectories: true)
            let ziel = ordner.appendingPathComponent(name)
            try FileManager.default.moveItem(at: ort, to: ziel)
            return ziel
        } catch {
            return nil
        }
    }

    private func zeige(_ datei: URL) {
        guard let anzeiger = anzeiger else { return }
        self.datei = datei
        let vorschau = QLPreviewController()
        vorschau.dataSource = self
        (anzeiger.presentedViewController ?? anzeiger).present(vorschau, animated: true)
    }

    private func meldeFehler() {
        guard let anzeiger = anzeiger else { return }
        let alert = UIAlertController(
            title: "Datei nicht geöffnet",
            message: "Die Datei liess sich nicht laden. Versuch es nochmals.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        (anzeiger.presentedViewController ?? anzeiger).present(alert, animated: true)
    }

    private func zeigeRad(_ an: Bool) {
        guard let ansicht = anzeiger?.view else { return }
        if !an {
            rad?.stopAnimating()
            rad?.removeFromSuperview()
            rad = nil
            return
        }
        let neu = UIActivityIndicatorView(style: .large)
        neu.translatesAutoresizingMaskIntoConstraints = false
        ansicht.addSubview(neu)
        NSLayoutConstraint.activate([
            neu.centerXAnchor.constraint(equalTo: ansicht.centerXAnchor),
            neu.centerYAnchor.constraint(equalTo: ansicht.centerYAnchor),
        ])
        neu.startAnimating()
        rad = neu
    }

    // MARK: - QLPreviewControllerDataSource

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        datei == nil ? 0 : 1
    }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        (datei ?? URL(fileURLWithPath: NSTemporaryDirectory())) as NSURL
    }
}

/// Fängt Datei-Navigationen ab, bevor Capacitor sie ins App-Fenster lädt (eigener
/// Host) oder an Safari gibt (fremder Host — dort fehlt die Anmeldung). Capacitor
/// fragt `shouldOverrideLoad` jedes Plugins vor seiner eigenen Entscheidung;
/// `true` bricht die Navigation ab, `nil` lässt Capacitor entscheiden.
@objc(NativeDateiNavigation)
final class NativeDateiNavigation: CAPPlugin, CAPBridgedPlugin {
    let identifier = "NativeDateiNavigation"
    let jsName = "NativeDateiNavigation"
    let pluginMethods: [CAPPluginMethod] = []

    weak var datei: NativeDatei?

    override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        // Nur das Hauptfenster oder ein neues Fenster, keine Frames in der Seite
        let hauptfenster = navigationAction.targetFrame?.isMainFrame ?? true
        guard hauptfenster,
              let url = navigationAction.request.url,
              NativeDatei.istDatei(url, appHost: bridge?.config.serverURL.host),
              let datei = datei else { return nil }
        DispatchQueue.main.async { datei.oeffne(url) }
        return NSNumber(value: true)
    }
}
