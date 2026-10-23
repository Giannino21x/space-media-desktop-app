import AVFoundation
import Foundation
import UIKit
import WebKit

/// Aufnahme im Hintergrund (ab 1.0.6, Bauplan Etappe 3): nimmt mit
/// `AVAudioRecorder` auf — auch bei gesperrtem iPhone (UIBackgroundModes audio) —
/// und lädt alle 30 Sekunden die neuen Bytes als Teil hoch. Das Format ist AAC in
/// ADTS-Rahmen (.aac): jeder Rahmen trägt seinen Kopf selbst, darum ergeben die
/// Teile, auf dem Server aneinandergehängt (audio/finalize), wieder genau die Datei.
///
/// Hochladen und Abschliessen gehen mit einem Aufnahme-Ticket der Web-App
/// (`Authorization: Bearer …`), nicht mit der Sitzung der WebView: die schläft bei
/// gesperrtem iPhone, und ihr Refresh-Token darf ihr niemand wegnehmen. So reicht
/// auch «Fertig» in der Dynamic Island, ohne die App zu öffnen.
///
///   Web -> Nativ: webkit.messageHandlers.nativeAufnahme.postMessage(
///                 {befehl: "start", sitzung, ticket, basis, titel}
///                 | {befehl: "nochmal", ticket?}
///                 | {befehl: "pause"|"weiter"|"stopp"|"verwerfen"|"stand"})
///   Nativ -> Web: window.__nativeAufnahmeMeldung({zustand, sitzung, dauerSek, pegel,
///                 offen, fehler?, hinweis?, mikrofon?}) — bei jedem Wechsel, beim
///                 Aufnehmen im Vordergrund zehnmal pro Sekunde (Pegel, Dauer).
///   Flag:         html[data-native-aufnahme="1"]
///   Gegenstück:   src/lib/mobile/native-recorder.ts im Web-Repo.
///
/// Jede Aufnahme hat einen Ordner in Application Support/Aufnahmen/<sitzung> mit
/// Datei, Teilen und Stand. Wird die App beendet, gehen liegengebliebene Teile beim
/// nächsten Start hoch, und die Aufnahme wird abgeschlossen.
final class NativeAufnahme: NSObject, WKScriptMessageHandler, AVAudioRecorderDelegate {

    private enum Zustand: String {
        case leer, startet, laeuft, pausiert, sichert, fertig, fehler
    }

    /// Stand einer Aufnahme auf der Platte (stand.json im Ordner der Sitzung).
    private struct Stand: Codable {
        var sitzung: String
        var ticket: String
        var basis: String
        var titel: String
        /// Index des nächsten Teils (= Anzahl geschnittener Teile)
        var naechsterTeil = 0
        /// Bytes der Aufnahme-Datei, die schon in Teilen stecken
        var geschnitten: UInt64 = 0
        var dauerSek: Double = 0
        /// Aufnahme vorbei — es fehlen nur noch Hochladen und Abschluss
        var gestoppt = false
        var angelegt = Date()
    }

    private struct Fehlschlag: Error {
        let status: Int
        let text: String?
        /// Netz weg oder Server kurz nicht da: später von selbst nochmals
        var voruebergehend: Bool { status == 0 || status >= 500 }
    }

    private static let teilAlle: TimeInterval = 30
    private static let mime = "audio/aac"
    /// Liegengebliebenes nach drei Tagen aufgeben (das Ticket gilt 12 Stunden, die Web-App holt ein neues)
    private static let aufgebenNach: TimeInterval = 3 * 24 * 3600

    private weak var webView: WKWebView?
    private weak var insel: LiveActivityBridge?

    private var recorder: AVAudioRecorder?
    private var stand: Stand?
    private var zustand: Zustand = .leer
    private var fehlerText: String?
    private var fehlerVoruebergehend = false
    private var hinweis: String?
    private var mikrofonVerweigert = false
    private var pegel: Double = 0
    private var unterbrochen = false
    private var letzterSchnittFuer: String?

    private var teilTakt: Timer?
    private var meldeTakt: Timer?
    /// Sitzungen, deren Teile hochgehen (und die danach abgeschlossen werden) — eine nach der anderen
    private var warteschlange: [String] = []
    private var arbeitet = false
    private var hintergrundAufgabe: UIBackgroundTaskIdentifier = .invalid

    private lazy var netz: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 120
        return URLSession(configuration: config)
    }()

    // MARK: - Einhängen

    func attach(to webView: WKWebView, insel: LiveActivityBridge) {
        self.webView = webView
        self.insel = insel
        webView.configuration.userContentController.add(self, name: "nativeAufnahme")
        webView.configuration.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.dataset.nativeAufnahme = '1'",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        // «Fertig» in der Insel (App Intent ab iOS 17, sonst spacemedia://aufnahme/stopp)
        NotificationCenter.default.addObserver(
            self, selector: #selector(fertigAngetippt), name: LiveActivityBridge.stoppNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(audioUnterbrochen(_:)),
            name: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance())
        NotificationCenter.default.addObserver(
            self, selector: #selector(wiederVorne), name: UIApplication.didBecomeActiveNotification, object: nil)
        liegengebliebenesAufnehmen()
    }

    // MARK: - Web -> Nativ

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeAufnahme",
              let body = message.body as? [String: Any],
              let befehl = body["befehl"] as? String else { return }
        switch befehl {
        case "start": starten(body)
        case "pause": pausieren()
        case "weiter": fortsetzen()
        case "stopp": stoppen()
        case "nochmal": nochmal(ticket: body["ticket"] as? String)
        case "verwerfen": verwerfen()
        case "stand": melden()
        default: break
        }
    }

    // MARK: - Aufnehmen

    private func starten(_ body: [String: Any]) {
        let sitzung = body["sitzung"] as? String ?? ""
        guard Self.istSitzungsId(sitzung),
              let ticket = body["ticket"] as? String, !ticket.isEmpty,
              let basis = (body["basis"] as? String).flatMap(basisPruefen) else {
            fehlerMelden("Die Aufnahme konnte nicht starten.", sitzung: sitzung)
            return
        }
        if let laufend = stand, !laufend.gestoppt, zustand == .startet || zustand == .laeuft || zustand == .pausiert {
            // Doppelter Start derselben Sitzung: nur den Stand melden
            if laufend.sitzung == sitzung { melden(); return }
            fehlerMelden("Es läuft schon eine Aufnahme.", sitzung: sitzung)
            return
        }
        let titel = (body["titel"] as? String).map { String($0.prefix(80)) }.flatMap { $0.isEmpty ? nil : $0 } ?? "Aufnahme"
        stand = Stand(sitzung: sitzung, ticket: ticket, basis: basis, titel: titel)
        zustand = .startet
        fehlerText = nil
        hinweis = nil
        mikrofonVerweigert = false
        pegel = 0
        letzterSchnittFuer = nil
        melden()
        mikrofonErlaubnis { [weak self] erlaubt in
            guard let self, self.stand?.sitzung == sitzung, self.zustand == .startet else { return }
            if erlaubt {
                self.aufnahmeBeginnen()
            } else {
                self.mikrofonVerweigert = true
                self.startScheitert("Mikrofon-Berechtigung verweigert")
            }
        }
    }

    private func mikrofonErlaubnis(_ fertig: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission { erlaubt in
                DispatchQueue.main.async { fertig(erlaubt) }
            }
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission { erlaubt in
                DispatchQueue.main.async { fertig(erlaubt) }
            }
        }
    }

    private func aufnahmeBeginnen() {
        guard var s = stand else { return }
        do {
            try FileManager.default.createDirectory(
                at: Self.ordner(s.sitzung), withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            let audio = AVAudioSession.sharedInstance()
            // Eingebautes Mikrofon auch mit AirPods (kein .allowBluetooth): es liegt auf dem Tisch
            try audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try audio.setActive(true)
            let einstellungen: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 48_000.0,
                AVNumberOfChannelsKey: 1,
                // 48 kbit/s Mono reichen für Sprache; 50 MB sind so gut 2 Stunden
                AVEncoderBitRateKey: 48_000,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
            // .aac → ADTS (der Typ folgt der Endung)
            let rec = try AVAudioRecorder(url: Self.audioDatei(s.sitzung), settings: einstellungen)
            rec.delegate = self
            rec.isMeteringEnabled = true
            guard rec.prepareToRecord(), rec.record() else {
                startScheitert("Die Aufnahme konnte nicht starten.")
                return
            }
            recorder = rec
            s.gestoppt = false
            stand = s
            Self.sichern(s)
            zustand = .laeuft
            takteStarten()
            inselLaeuft(s, dauer: 0)
            melden()
        } catch {
            NSLog("[NativeAufnahme] Start fehlgeschlagen: \(error.localizedDescription)")
            startScheitert("Die Aufnahme konnte nicht starten.")
        }
    }

    /// Start misslungen (Mikrofon verweigert, Audio belegt): melden, nichts liegen lassen
    private func startScheitert(_ text: String) {
        takteStoppen()
        recorder?.delegate = nil
        recorder?.stop()
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let sitzung = stand?.sitzung
        if let sitzung { try? FileManager.default.removeItem(at: Self.ordner(sitzung)) }
        zustand = .fehler
        fehlerText = text
        fehlerVoruebergehend = false
        melden()
        // Die Web-App löscht die leere Sitzung; danach gibt es hier nichts mehr
        stand = nil
        zustand = .leer
        mikrofonVerweigert = false
    }

    private func pausieren() {
        guard zustand == .laeuft, let rec = recorder, var s = stand else { melden(); return }
        s.dauerSek = max(s.dauerSek, rec.currentTime)
        rec.pause()
        stand = s
        Self.sichern(s)
        zustand = .pausiert
        pegel = 0
        insel?.nativeMeldung(["action": "aufnahme", "status": "pausiert", "titel": s.titel, "dauerSek": s.dauerSek])
        melden()
    }

    private func fortsetzen() {
        guard zustand == .pausiert, let rec = recorder, let s = stand else { melden(); return }
        try? AVAudioSession.sharedInstance().setActive(true)
        guard rec.record() else {
            melden()
            return
        }
        zustand = .laeuft
        inselLaeuft(s, dauer: max(s.dauerSek, rec.currentTime))
        melden()
    }

    @objc private func fertigAngetippt() {
        guard zustand == .laeuft || zustand == .pausiert else { return }
        stoppen()
    }

    private func stoppen() {
        guard var s = stand else { melden(); return }
        if zustand == .startet {
            // Noch kein Ton: wie ein misslungener Start
            startScheitert("Die Aufnahme wurde vor dem Start beendet.")
            return
        }
        guard !s.gestoppt else { melden(); return }
        if let rec = recorder { s.dauerSek = max(s.dauerSek, rec.currentTime) }
        s.gestoppt = true
        stand = s
        Self.sichern(s)
        zustand = .sichert
        fehlerText = nil
        takteStoppen()
        pegel = 0
        melden()
        let sitzung = s.sitzung
        if let rec = recorder {
            // audioRecorderDidFinishRecording schneidet den letzten Teil; bleibt er aus, nach 1,5 s trotzdem
            rec.stop()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.letzterSchnitt(sitzung) }
        } else {
            letzterSchnitt(sitzung)
        }
    }

    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let s = self.stand, s.gestoppt else { return }
            self.letzterSchnitt(s.sitzung)
        }
    }

    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        NSLog("[NativeAufnahme] Kodierfehler: \(error?.localizedDescription ?? "?")")
        // Was bis hier in der Datei steht, ist gesichert: wie «Fertig»
        DispatchQueue.main.async { [weak self] in
            guard let self, self.zustand == .laeuft || self.zustand == .pausiert else { return }
            self.stoppen()
        }
    }

    /// Rest der Datei als letzten Teil schneiden, dann hochladen und abschliessen
    private func letzterSchnitt(_ sitzung: String) {
        guard letzterSchnittFuer != sitzung, var s = stand, s.sitzung == sitzung else { return }
        letzterSchnittFuer = sitzung
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        Self.schneiden(&s)
        stand = s
        abarbeiten(sitzung)
    }

    private func verwerfen() {
        guard let s = stand else { melden(); return }
        takteStoppen()
        recorder?.delegate = nil
        recorder?.stop()
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        warteschlange.removeAll { $0 == s.sitzung }
        try? FileManager.default.removeItem(at: Self.ordner(s.sitzung))
        stand = nil
        zustand = .leer
        fehlerText = nil
        hinweis = nil
        pegel = 0
        insel?.nativeMeldung(["action": "ende"])
        melden()
    }

    private func nochmal(ticket: String?) {
        guard var s = stand, s.gestoppt else { melden(); return }
        // Die Web-App schickt ein frisches Ticket mit (das alte gilt 12 Stunden)
        if let ticket, !ticket.isEmpty {
            s.ticket = ticket
            stand = s
            Self.sichern(s)
        }
        zustand = .sichert
        fehlerText = nil
        melden()
        abarbeiten(s.sitzung)
    }

    // MARK: - Unterbrechung (Anruf, Siri)

    @objc private func audioUnterbrochen(_ notification: Notification) {
        guard let info = notification.userInfo,
              let roh = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let art = AVAudioSession.InterruptionType(rawValue: roh) else { return }
        switch art {
        case .began:
            // iOS hält den Rekorder selbst an
            guard zustand == .laeuft, var s = stand else { return }
            s.dauerSek = max(s.dauerSek, recorder?.currentTime ?? 0)
            stand = s
            Self.sichern(s)
            zustand = .pausiert
            pegel = 0
            unterbrochen = true
            insel?.nativeMeldung(["action": "aufnahme", "status": "pausiert", "titel": s.titel, "dauerSek": s.dauerSek])
            melden()
        case .ended:
            guard unterbrochen else { return }
            unterbrochen = false
            let optionen = (info[AVAudioSessionInterruptionOptionKey] as? UInt)
                .map { AVAudioSession.InterruptionOptions(rawValue: $0) } ?? []
            // Nach dem Anruf geht die Sitzung weiter — die Aufnahme auch
            if optionen.contains(.shouldResume), zustand == .pausiert { fortsetzen() }
        @unknown default:
            break
        }
    }

    // MARK: - Takte

    private func takteStarten() {
        takteStoppen()
        let teil = Timer(timeInterval: Self.teilAlle, repeats: true) { [weak self] _ in
            self?.teilTick()
        }
        RunLoop.main.add(teil, forMode: .common)
        teilTakt = teil
        // Pegel und Dauer für die Web-App — nur im Vordergrund, gesperrt schläft sie
        let melde = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self, UIApplication.shared.applicationState == .active else { return }
            self.pegelLesen()
            self.melden()
        }
        RunLoop.main.add(melde, forMode: .common)
        meldeTakt = melde
    }

    private func takteStoppen() {
        teilTakt?.invalidate()
        teilTakt = nil
        meldeTakt?.invalidate()
        meldeTakt = nil
    }

    /// Alle 30 Sekunden: neue Bytes als Teil, dann hochladen
    private func teilTick() {
        guard var s = stand, !s.gestoppt else { return }
        if let rec = recorder, rec.isRecording { s.dauerSek = max(s.dauerSek, rec.currentTime) }
        Self.schneiden(&s)
        stand = s
        abarbeiten(s.sitzung)
    }

    private func pegelLesen() {
        guard zustand == .laeuft, let rec = recorder, rec.isRecording else { pegel = 0; return }
        rec.updateMeters()
        // -50 dBFS still, -10 dBFS lautes Sprechen → 0 … 100
        let db = Double(rec.averagePower(forChannel: 0))
        pegel = max(0, min(100, (db + 50) / 40 * 100))
    }

    // MARK: - Teile schneiden

    /// Neue Bytes der Aufnahme-Datei als nächsten Teil auf die Platte legen.
    /// Ein Schnitt mitten in einem Rahmen schadet nicht: der nächste Teil beginnt
    /// beim nächsten Byte, aneinandergehängt ist es wieder dieselbe Datei.
    private static func schneiden(_ s: inout Stand) {
        guard let handle = try? FileHandle(forReadingFrom: audioDatei(s.sitzung)) else { return }
        defer { try? handle.close() }
        guard let ende = try? handle.seekToEnd(), ende > s.geschnitten else { return }
        do {
            try handle.seek(toOffset: s.geschnitten)
            guard let daten = try handle.read(upToCount: Int(ende - s.geschnitten)), !daten.isEmpty else { return }
            try daten.write(to: teilDatei(s.sitzung, s.naechsterTeil),
                            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            s.geschnitten += UInt64(daten.count)
            s.naechsterTeil += 1
            sichern(s)
        } catch {
            NSLog("[NativeAufnahme] Schneiden fehlgeschlagen: \(error.localizedDescription)")
        }
    }

    // MARK: - Hochladen und Abschliessen

    /// Teile dieser Sitzung hochladen; ist ihre Aufnahme gestoppt und alles oben, abschliessen.
    private func abarbeiten(_ sitzung: String) {
        if !warteschlange.contains(sitzung) { warteschlange.append(sitzung) }
        weiterArbeiten()
    }

    private func weiterArbeiten() {
        guard !arbeitet, let sitzung = warteschlange.first else {
            if !arbeitet { hintergrundBeenden() }
            return
        }
        guard let s = (stand?.sitzung == sitzung ? stand : Self.laden(sitzung)) else {
            warteschlange.removeFirst()
            weiterArbeiten()
            return
        }
        arbeitet = true
        hintergrundBeginnen()
        teileHochladen(s, Self.offeneTeile(sitzung)) { [weak self] fehlschlag in
            guard let self else { return }
            if let fehlschlag {
                self.erledigt(sitzung, erfolgreich: false)
                self.gescheitert(sitzung, fehlschlag)
                return
            }
            let aktuell = self.stand?.sitzung == sitzung ? self.stand : Self.laden(sitzung)
            // Aufnahme läuft noch: bis zum nächsten Teil ist alles oben
            guard let s2 = aktuell, s2.gestoppt else {
                self.erledigt(sitzung, erfolgreich: true)
                self.meldenFuer(sitzung)
                return
            }
            guard s2.naechsterTeil > 0 else {
                self.erledigt(sitzung, erfolgreich: false)
                self.gescheitert(sitzung, Fehlschlag(status: 400, text: "Die Aufnahme ist leer."))
                return
            }
            self.abschliessen(s2, versuch: 0) { ergebnis in
                switch ergebnis {
                case .success(let hinweis):
                    self.erledigt(sitzung, erfolgreich: true)
                    self.abgeschlossen(s2, hinweis: hinweis)
                case .failure(let fehlschlag):
                    self.erledigt(sitzung, erfolgreich: false)
                    self.gescheitert(sitzung, fehlschlag)
                }
            }
        }
    }

    /// Sitzung aus der Warteschlange; die nächste kommt dran. Wurden während des
    /// Hochladens neue Teile geschnitten, geht diese Sitzung gleich nochmals durch
    /// (nach einem Fehlschlag nicht — sonst drehte sie ohne Netz im Kreis).
    private func erledigt(_ sitzung: String, erfolgreich: Bool) {
        warteschlange.removeAll { $0 == sitzung }
        arbeitet = false
        if erfolgreich, !Self.offeneTeile(sitzung).isEmpty, Self.laden(sitzung) != nil {
            warteschlange.append(sitzung)
        }
        DispatchQueue.main.async { [weak self] in self?.weiterArbeiten() }
    }

    private func teileHochladen(_ s: Stand, _ teile: [Int], fertig: @escaping (Fehlschlag?) -> Void) {
        guard let index = teile.first else { fertig(nil); return }
        let rest = Array(teile.dropFirst())
        // Nicht lesbar (z. B. vor dem ersten Entsperren): später nochmals, nie im Kreis
        guard let daten = try? Data(contentsOf: Self.teilDatei(s.sitzung, index)),
              let url = URL(string: "\(s.basis)/api/meetings/\(s.sitzung)/audio/upload") else {
            fertig(Fehlschlag(status: 0, text: nil))
            return
        }
        let grenze = "SpaceMedia-\(UUID().uuidString)"
        var anfrage = URLRequest(url: url)
        anfrage.httpMethod = "POST"
        anfrage.setValue("Bearer \(s.ticket)", forHTTPHeaderField: "Authorization")
        anfrage.setValue("multipart/form-data; boundary=\(grenze)", forHTTPHeaderField: "Content-Type")
        anfrage.httpBody = Self.formular(grenze: grenze, teil: daten, index: index)
        netz.dataTask(with: anfrage) { antwort, response, _ in
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard status == 200 else {
                    fertig(Fehlschlag(status: status, text: Self.serverSatz(antwort)))
                    return
                }
                try? FileManager.default.removeItem(at: Self.teilDatei(s.sitzung, index))
                self.meldenFuer(s.sitzung)
                self.teileHochladen(s, rest, fertig: fertig)
            }
        }.resume()
    }

    private func abschliessen(_ s: Stand, versuch: Int, fertig: @escaping (Result<String?, Fehlschlag>) -> Void) {
        guard let url = URL(string: "\(s.basis)/api/meetings/\(s.sitzung)/audio/finalize") else {
            fertig(.failure(Fehlschlag(status: 400, text: nil)))
            return
        }
        var anfrage = URLRequest(url: url)
        anfrage.httpMethod = "POST"
        anfrage.setValue("Bearer \(s.ticket)", forHTTPHeaderField: "Authorization")
        anfrage.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let json: [String: Any] = [
            "duration_seconds": Int(s.dauerSek.rounded()),
            "mime_type": Self.mime,
            "ext": "aac",
            "total_chunks": s.naechsterTeil,
            "trigger_transcription": true,
        ]
        anfrage.httpBody = try? JSONSerialization.data(withJSONObject: json)
        netz.dataTask(with: anfrage) { antwort, response, _ in
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let body = antwort.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
                if status == 200 {
                    var hinweis: String?
                    if body?["code"] as? String == "transcription_not_configured" {
                        hinweis = "transkription_fehlt"
                    } else if body?["already_finalized"] as? Bool == true, body?["auto_finalized"] as? Bool == true {
                        hinweis = "automatisch"
                    }
                    fertig(.success(hinweis))
                } else if status == 409, body?["code"] as? String == "finalize_running", versuch < 8 {
                    // Der Server schliesst gerade selbst ab (Cron): gleich nochmals fragen
                    DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                        self.abschliessen(s, versuch: versuch + 1, fertig: fertig)
                    }
                } else {
                    fertig(.failure(Fehlschlag(status: status, text: body?["error"] as? String)))
                }
            }
        }.resume()
    }

    private func abgeschlossen(_ s: Stand, hinweis: String?) {
        try? FileManager.default.removeItem(at: Self.ordner(s.sitzung))
        // Liegengebliebenes aus einer früheren Aufnahme: still erledigt
        guard stand?.sitzung == s.sitzung else { return }
        zustand = .fertig
        self.hinweis = hinweis
        fehlerText = nil
        // Insel: «Steno schreibt» (die Web-App meldet später «Protokoll bereit»)
        insel?.nativeMeldung(["action": "aufnahme", "status": "schreibt", "titel": s.titel])
        melden()
    }

    private func gescheitert(_ sitzung: String, _ fehlschlag: Fehlschlag) {
        NSLog("[NativeAufnahme] Hochladen/Abschluss fehlgeschlagen: HTTP \(fehlschlag.status)")
        guard stand?.sitzung == sitzung else { return }
        // Während der Aufnahme: weiter aufnehmen, der nächste Takt versucht es wieder
        if zustand == .laeuft || zustand == .pausiert {
            melden()
            return
        }
        zustand = .fehler
        fehlerVoruebergehend = fehlschlag.voruebergehend
        fehlerText = Self.satz(fehlschlag)
        insel?.nativeMeldung(["action": "ende"])
        melden()
    }

    private static func satz(_ f: Fehlschlag) -> String {
        if f.status == 0 { return "Keine Internetverbindung. Die Aufnahme ist auf dem iPhone gesichert." }
        if f.status == 401 { return "Die Anmeldung für das Hochladen ist abgelaufen. Bitte nochmals hochladen." }
        if let text = f.text, !text.isEmpty { return text }
        return "Hochladen fehlgeschlagen (HTTP \(f.status))."
    }

    private static func serverSatz(_ daten: Data?) -> String? {
        guard let daten, let body = try? JSONSerialization.jsonObject(with: daten) as? [String: Any] else { return nil }
        return body["error"] as? String
    }

    private static func formular(grenze: String, teil: Data, index: Int) -> Data {
        var body = Data()
        func text(_ s: String) { body.append(s.data(using: .utf8) ?? Data()) }
        text("--\(grenze)\r\nContent-Disposition: form-data; name=\"chunk\"; filename=\"chunk-\(index).bin\"\r\n")
        text("Content-Type: \(mime)\r\n\r\n")
        body.append(teil)
        text("\r\n--\(grenze)\r\nContent-Disposition: form-data; name=\"index\"\r\n\r\n\(index)\r\n")
        text("--\(grenze)\r\nContent-Disposition: form-data; name=\"mimeType\"\r\n\r\n\(mime)\r\n")
        text("--\(grenze)--\r\n")
        return body
    }

    // MARK: - Liegengebliebenes und Vordergrund

    /// App neu gestartet: Aufnahmen, deren App beendet wurde, sind vorbei — was in der
    /// Datei steht, geht hoch und wird abgeschlossen. Die jüngste zeigt die Web-App an.
    private func liegengebliebenesAufnehmen() {
        let ordner = (try? FileManager.default.contentsOfDirectory(
            at: Self.wurzel, includingPropertiesForKeys: nil)) ?? []
        var staende: [Stand] = []
        for o in ordner {
            guard var s = Self.laden(o.lastPathComponent) else {
                try? FileManager.default.removeItem(at: o)
                continue
            }
            if Date().timeIntervalSince(s.angelegt) > Self.aufgebenNach {
                try? FileManager.default.removeItem(at: o)
                continue
            }
            if !s.gestoppt {
                s.gestoppt = true
                Self.schneiden(&s)
                Self.sichern(s)
            }
            staende.append(s)
        }
        guard !staende.isEmpty else { return }
        staende.sort { $0.angelegt < $1.angelegt }
        if let juengste = staende.last {
            stand = juengste
            zustand = .sichert
        }
        for s in staende { abarbeiten(s.sitzung) }
    }

    @objc private func wiederVorne() {
        // Netz war weg: still nochmals versuchen
        if zustand == .fehler, fehlerVoruebergehend, let s = stand, s.gestoppt {
            zustand = .sichert
            fehlerText = nil
            abarbeiten(s.sitzung)
        }
        melden()
    }

    private func hintergrundBeginnen() {
        guard hintergrundAufgabe == .invalid else { return }
        hintergrundAufgabe = UIApplication.shared.beginBackgroundTask(withName: "Aufnahme hochladen") { [weak self] in
            self?.hintergrundBeenden()
        }
    }

    private func hintergrundBeenden() {
        guard hintergrundAufgabe != .invalid else { return }
        UIApplication.shared.endBackgroundTask(hintergrundAufgabe)
        hintergrundAufgabe = .invalid
    }

    // MARK: - Nativ -> Web

    private func meldenFuer(_ sitzung: String) {
        if stand?.sitzung == sitzung { melden() }
    }

    private func melden() {
        var dauer = stand?.dauerSek ?? 0
        if zustand == .laeuft, let rec = recorder, rec.isRecording { dauer = max(dauer, rec.currentTime) }
        var meldung: [String: Any] = [
            "zustand": zustand.rawValue,
            // leer = keine Aufnahme (die Web-App liest das als null)
            "sitzung": stand?.sitzung ?? "",
            "dauerSek": Int(dauer),
            "pegel": Int(pegel.rounded()),
            "offen": stand.map { Self.offeneTeile($0.sitzung).count } ?? 0,
        ]
        if zustand == .fehler, let fehlerText { meldung["fehler"] = fehlerText }
        if zustand == .fertig, let hinweis { meldung["hinweis"] = hinweis }
        if mikrofonVerweigert { meldung["mikrofon"] = true }
        guard let json = try? JSONSerialization.data(withJSONObject: meldung),
              let text = String(data: json, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__nativeAufnahmeMeldung && window.__nativeAufnahmeMeldung(\(text))")
    }

    private func fehlerMelden(_ text: String, sitzung: String) {
        guard let json = try? JSONSerialization.data(withJSONObject: [
            "zustand": "fehler", "sitzung": sitzung, "dauerSek": 0, "pegel": 0, "offen": 0, "fehler": text,
        ] as [String: Any]), let meldung = String(data: json, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__nativeAufnahmeMeldung && window.__nativeAufnahmeMeldung(\(meldung))")
    }

    private func inselLaeuft(_ s: Stand, dauer: Double) {
        insel?.nativeMeldung([
            "action": "aufnahme", "status": "laeuft", "titel": s.titel,
            "startMs": (Date().timeIntervalSince1970 - dauer) * 1000,
        ])
    }

    // MARK: - Ablage

    private static var wurzel: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Aufnahmen", isDirectory: true)
    }

    private static func ordner(_ sitzung: String) -> URL {
        wurzel.appendingPathComponent(sitzung, isDirectory: true)
    }

    private static func audioDatei(_ sitzung: String) -> URL {
        ordner(sitzung).appendingPathComponent("aufnahme.aac")
    }

    private static func standDatei(_ sitzung: String) -> URL {
        ordner(sitzung).appendingPathComponent("stand.json")
    }

    private static func teilDatei(_ sitzung: String, _ index: Int) -> URL {
        ordner(sitzung).appendingPathComponent(String(format: "teil-%06d.bin", index))
    }

    private static func sichern(_ s: Stand) {
        guard let daten = try? JSONEncoder().encode(s) else { return }
        try? daten.write(to: standDatei(s.sitzung), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private static func laden(_ sitzung: String) -> Stand? {
        guard istSitzungsId(sitzung), let daten = try? Data(contentsOf: standDatei(sitzung)) else { return nil }
        return try? JSONDecoder().decode(Stand.self, from: daten)
    }

    /// Indizes der Teile, die noch auf dem iPhone liegen
    private static func offeneTeile(_ sitzung: String) -> [Int] {
        let namen = (try? FileManager.default.contentsOfDirectory(atPath: ordner(sitzung).path)) ?? []
        return namen.compactMap { name -> Int? in
            guard name.hasPrefix("teil-"), name.hasSuffix(".bin") else { return nil }
            return Int(name.dropFirst(5).dropLast(4))
        }.sorted()
    }

    private static func istSitzungsId(_ wert: String) -> Bool {
        wert.range(of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
                   options: .regularExpression) != nil
    }

    /// Nur die eigene Adresse (die der WebView, https) — das Ticket geht nirgends sonst hin
    private func basisPruefen(_ basis: String) -> String? {
        guard let url = URL(string: basis), url.scheme == "https", let host = url.host,
              host == webView?.url?.host else { return nil }
        var teile = URLComponents()
        teile.scheme = "https"
        teile.host = host
        teile.port = url.port
        return teile.string
    }
}
