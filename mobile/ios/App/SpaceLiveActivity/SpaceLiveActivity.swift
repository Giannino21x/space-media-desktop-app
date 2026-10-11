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

private let aufnahmeRot = Color(red: 1.0, green: 0.27, blue: 0.23)
private let pauseOrange = Color(red: 1.0, green: 0.62, blue: 0.04)
private let stenoGelb = Color(red: 0.984, green: 0.749, blue: 0.141)

@available(iOS 16.2, *)
private func kennfarbe(_ state: AufnahmeAttributes.ContentState) -> Color {
    switch state.status {
    case "pausiert": return pauseOrange
    case "schreibt", "bereit": return stenoGelb
    default: return aufnahmeRot
    }
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
                DynamicIslandExpandedRegion(.leading) {
                    StatusSymbol(state: context.state, groesse: 40)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if context.state.aufnahme {
                        Dauer(state: context.state)
                            .font(.system(size: 28, weight: .semibold, design: .rounded))
                            .frame(maxWidth: 110, alignment: .trailing)
                            .padding(.trailing, 4)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.status == "bereit" ? "Protokoll bereit" : context.attributes.titel)
                            .font(.headline)
                            .lineLimit(1)
                        Text(context.state.status == "bereit" ? context.attributes.titel : zeile(context.state))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if context.state.aufnahme {
                        FertigKnopf()
                            .padding(.top, 6)
                    } else if context.state.status == "bereit" {
                        AnsehenKnopf(ziel: ziel(context.state))
                            .padding(.top, 6)
                    }
                }
            } compactLeading: {
                StatusSymbol(state: context.state, groesse: 22)
            } compactTrailing: {
                KompaktRechts(state: context.state)
            } minimal: {
                StatusSymbol(state: context.state, groesse: 22)
            }
            .widgetURL(ziel(context.state))
            .keylineTint(kennfarbe(context.state))
        }
    }
}

/// Kreis mit Zeichen: Wellenform (läuft), Pause, Stift (schreibt), Haken (bereit)
@available(iOS 16.2, *)
private struct StatusSymbol: View {
    let state: AufnahmeAttributes.ContentState
    let groesse: CGFloat

    private var symbol: String {
        switch state.status {
        case "pausiert": return "pause.fill"
        case "schreibt": return "pencil.line"
        case "bereit": return "checkmark"
        default: return "waveform"
        }
    }

    var body: some View {
        ZStack {
            Circle().fill(kennfarbe(state).opacity(0.22))
            Image(systemName: symbol)
                .font(.system(size: groesse * 0.46, weight: .semibold))
                .foregroundStyle(kennfarbe(state))
        }
        .frame(width: groesse, height: groesse)
    }
}

/// Rechts der Kamera: Uhr während der Aufnahme, sonst ein Wort
@available(iOS 16.2, *)
private struct KompaktRechts: View {
    let state: AufnahmeAttributes.ContentState

    var body: some View {
        if state.aufnahme {
            Dauer(state: state)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .frame(maxWidth: 52)
        } else {
            Text(state.status == "bereit" ? "Bereit" : "schreibt")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(stenoGelb)
        }
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
        .foregroundStyle(state.laeuft ? Color.white : pauseOrange)
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
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(Color.white, in: Capsule())
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
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity, minHeight: 40)
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
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
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
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.black)
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
            .foregroundStyle(.black)
            .frame(width: 44, height: 44)
            .background(Color.white, in: Circle())
    }
}
