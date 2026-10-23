import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// Widget-Erweiterung: zeichnet die Live Activity einer Aufnahme in der
/// Dynamic Island (kompakt, minimal, aufgeklappt) und auf dem
/// Sperrbildschirm. Gestartet und beendet wird sie von der App
/// (LiveActivityBridge), die Uhr zählt hier selbst (Text(timerInterval:)).
///
/// Zustände (Canvas «Sys-Island»): Aufnahme läuft · Pausiert · Steno schreibt
/// · Protokoll bereit. Schwarzer Grund, Stenos Gelb als Kennfarbe, ein
/// einziger Knopf «Fertig» während der Aufnahme.
@main
struct SpaceLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        AufnahmeLiveActivity()
    }
}

/// Stenos Gelb in jedem Zustand (Canvas «Sys-Island»), Grau nur für die Pause.
/// Rot las sich in der Insel wie ein Fehler (1.0.6 Build 24).
private let stenoGelb = Color(red: 0.984, green: 0.749, blue: 0.141)
private let pauseGrau = Color(red: 0.604, green: 0.604, blue: 0.635)
/// Schrift auf gelbem Knopf
private let aufGelb = Color(red: 0.102, green: 0.078, blue: 0.024)

@available(iOS 16.2, *)
private func kennfarbe(_ state: AufnahmeAttributes.ContentState) -> Color {
    state.status == "pausiert" ? pauseGrau : stenoGelb
}

@available(iOS 16.2, *)
private func zeile(_ state: AufnahmeAttributes.ContentState) -> String {
    switch state.status {
    case "pausiert": return "Pausiert"
    case "schreibt": return "Steno schreibt …"
    case "bereit": return "Protokoll bereit"
    default: return "Aufnahme läuft"
    }
}

@available(iOS 16.2, *)
private func ziel(_ state: AufnahmeAttributes.ContentState) -> URL {
    state.status == "bereit" ? AufnahmeLink.dokument(state.pfad) : AufnahmeLink.oeffnen
}

@available(iOS 16.2, *)
struct AufnahmeLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AufnahmeAttributes.self) { context in
            SperrbildschirmAnsicht(context: context)
                .activityBackgroundTint(Color.black.opacity(0.78))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(ziel(context.state))
        } dynamicIsland: { context in
            DynamicIsland {
                // Oben links was läuft, oben rechts die grosse Uhr (oder das Zeichen)
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Label(zeile(context.state), systemImage: context.state.aufnahme ? "mic.fill" : symbol(context.state))
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(kennfarbe(context.state))
                        Text(context.attributes.titel)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                    .lineLimit(1)
                    .padding(.leading, 6)
                    .dynamicIsland(verticalPlacement: .belowIfTooWide)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Group {
                        if context.state.aufnahme {
                            Dauer(state: context.state)
                                .font(.system(size: 34, weight: .bold))
                        } else if context.state.status == "schreibt" {
                            Fortschritt(groesse: 30)
                        } else {
                            Image(systemName: "checkmark")
                                .font(.system(size: 30, weight: .bold))
                                .foregroundStyle(stenoGelb)
                        }
                    }
                    .frame(maxWidth: 130, alignment: .trailing)
                    .padding(.trailing, 6)
                    .dynamicIsland(verticalPlacement: .belowIfTooWide)
                }
                // Ein einziger Knopf, wie Apple es für Aufnahmen empfiehlt
                DynamicIslandExpandedRegion(.bottom) {
                    if context.state.aufnahme {
                        HStack(spacing: 10) {
                            Wellenbalken(farbe: kennfarbe(context.state))
                            FertigKnopf()
                        }
                        .padding(.horizontal, 6)
                        .padding(.top, 6)
                    } else if context.state.status == "bereit" {
                        HStack {
                            Spacer(minLength: 0)
                            AnsehenKnopf(ziel: ziel(context.state))
                        }
                        .padding(.horizontal, 6)
                        .padding(.top, 6)
                    }
                }
            } compactLeading: {
                Image(systemName: symbol(context.state))
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(kennfarbe(context.state))
                    .padding(.leading, 2)
            } compactTrailing: {
                KompaktRechts(state: context.state)
            } minimal: {
                Image(systemName: symbol(context.state))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(kennfarbe(context.state))
            }
            .widgetURL(ziel(context.state))
            .keylineTint(kennfarbe(context.state))
        }
    }
}

/// Zeichen: Wellenform (läuft), Pause, Stift (schreibt), Haken (bereit)
@available(iOS 16.2, *)
private func symbol(_ state: AufnahmeAttributes.ContentState) -> String {
    switch state.status {
    case "pausiert": return "pause.fill"
    case "schreibt": return "pencil.line"
    case "bereit": return "checkmark"
    default: return "waveform"
    }
}

/// Sperrbildschirm: Zeichen im getönten Kreis (in der Insel ohne Kreis)
@available(iOS 16.2, *)
private struct StatusSymbol: View {
    let state: AufnahmeAttributes.ContentState
    let groesse: CGFloat

    var body: some View {
        ZStack {
            Circle().fill(kennfarbe(state).opacity(0.22))
            Image(systemName: symbol(state))
                .font(.system(size: groesse * 0.46, weight: .semibold))
                .foregroundStyle(kennfarbe(state))
        }
        .frame(width: groesse, height: groesse)
    }
}

/// Rechts der Kamera: Uhr während der Aufnahme, Ring beim Schreiben, «Bereit»
@available(iOS 16.2, *)
private struct KompaktRechts: View {
    let state: AufnahmeAttributes.ContentState

    var body: some View {
        if state.aufnahme {
            Dauer(state: state)
                .font(.system(size: 15, weight: .bold))
                .frame(maxWidth: 64, alignment: .trailing)
        } else if state.status == "schreibt" {
            Fortschritt(groesse: 18)
        } else {
            Text("Bereit")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(stenoGelb)
        }
    }
}

/// «Steno schreibt»: Ring mit gelbem Bogen (der Server meldet keinen Prozentstand)
private struct Fortschritt: View {
    let groesse: CGFloat

    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.2), lineWidth: groesse * 0.16)
            Circle()
                .trim(from: 0, to: 0.35)
                .stroke(stenoGelb, style: StrokeStyle(lineWidth: groesse * 0.16, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: groesse, height: groesse)
    }
}

/// Aufgeklappt neben «Fertig»: feste Balken als Zeichen für Ton (Widgets
/// bekommen keinen Pegel)
private struct Wellenbalken: View {
    let farbe: Color
    private let hoehen: [CGFloat] = [8, 16, 22, 12, 18, 24, 14, 8, 16, 10]

    var body: some View {
        HStack(spacing: 3) {
            ForEach(hoehen.indices, id: \.self) { i in
                Capsule()
                    .fill(farbe)
                    .frame(maxWidth: .infinity)
                    .frame(height: hoehen[i])
            }
        }
        .frame(height: 24)
        .accessibilityHidden(true)
    }
}

/// Laufend: Uhr, die das System selbst weiterzählt. Pausiert: feste Dauer.
@available(iOS 16.2, *)
private struct Dauer: View {
    let state: AufnahmeAttributes.ContentState

    var body: some View {
        Group {
            if state.laeuft {
                Text(timerInterval: state.start...Date.distantFuture, countsDown: false)
            } else {
                Text(Self.format(state.dauerSek))
            }
        }
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .foregroundStyle(kennfarbe(state))
    }

    static func format(_ sek: Int) -> String {
        let h = sek / 3600, m = (sek % 3600) / 60, s = sek % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

/// «Fertig»: ab iOS 17 per App Intent direkt (ohne App zu öffnen), sonst öffnet
/// der Link die App und beendet dort (AppDelegate → Web-App).
private struct FertigKnopf: View {
    private var beschriftung: some View {
        Text("Fertig")
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(aufGelb)
            .padding(.horizontal, 16)
            .frame(minHeight: 40)
            .background(stenoGelb, in: Capsule())
    }

    var body: some View {
        if #available(iOS 17.0, *) {
            Button(intent: AufnahmeFertigIntent()) { beschriftung }
                .buttonStyle(.plain)
        } else {
            Link(destination: AufnahmeLink.stopp) { beschriftung }
        }
    }
}

private struct AnsehenKnopf: View {
    let ziel: URL

    var body: some View {
        Link(destination: ziel) {
            Text("Ansehen")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(aufGelb)
                .padding(.horizontal, 18)
                .frame(minHeight: 40)
                .background(stenoGelb, in: Capsule())
        }
    }
}

@available(iOS 16.2, *)
private struct SperrbildschirmAnsicht: View {
    let context: ActivityViewContext<AufnahmeAttributes>

    var body: some View {
        HStack(spacing: 14) {
            StatusSymbol(state: context.state, groesse: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.titel)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text(zeile(context.state))
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.7))
            }
            Spacer(minLength: 8)
            if context.state.aufnahme {
                Dauer(state: context.state)
                    .font(.system(size: 26, weight: .bold))
                    .frame(maxWidth: 110, alignment: .trailing)
                if #available(iOS 17.0, *) {
                    Button(intent: AufnahmeFertigIntent()) { fertigKreis }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Fertig")
                } else {
                    Link(destination: AufnahmeLink.stopp) { fertigKreis }
                        .accessibilityLabel("Fertig")
                }
            } else if context.state.status == "bereit" {
                Link(destination: ziel(context.state)) {
                    Text("Ansehen")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(aufGelb)
                        .padding(.horizontal, 14)
                        .frame(height: 36)
                        .background(stenoGelb, in: Capsule())
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
    }

    private var fertigKreis: some View {
        Image(systemName: "checkmark")
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(aufGelb)
            .frame(width: 44, height: 44)
            .background(stenoGelb, in: Circle())
    }
}
