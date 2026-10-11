import ActivityKit
import SwiftUI
import WidgetKit

/// Widget-Erweiterung: zeichnet die Live Activity einer laufenden Aufnahme in
/// der Dynamic Island (kompakt, minimal, aufgeklappt) und auf dem
/// Sperrbildschirm. Gestartet und beendet wird sie von der App
/// (LiveActivityBridge), die Uhr zählt hier selbst (Text(timerInterval:)).
@main
struct SpaceLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        AufnahmeLiveActivity()
    }
}

private let aufnahmeRot = Color(red: 1.0, green: 0.27, blue: 0.23)
private let pauseOrange = Color(red: 1.0, green: 0.62, blue: 0.04)

@available(iOS 16.2, *)
struct AufnahmeLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AufnahmeAttributes.self) { context in
            SperrbildschirmAnsicht(context: context)
                .activityBackgroundTint(Color.black.opacity(0.78))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(AufnahmeLink.oeffnen)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    StatusSymbol(laeuft: context.state.laeuft, groesse: 40)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Dauer(state: context.state)
                        .font(.system(size: 28, weight: .semibold, design: .rounded))
                        .frame(maxWidth: 110, alignment: .trailing)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.titel)
                            .font(.headline)
                            .lineLimit(1)
                        Text(context.state.laeuft ? "Aufnahme läuft" : "Pausiert")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    StoppKnopf()
                        .padding(.top, 6)
                }
            } compactLeading: {
                StatusSymbol(laeuft: context.state.laeuft, groesse: 22)
            } compactTrailing: {
                Dauer(state: context.state)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .frame(maxWidth: 52)
            } minimal: {
                StatusSymbol(laeuft: context.state.laeuft, groesse: 22)
            }
            .widgetURL(AufnahmeLink.oeffnen)
            .keylineTint(context.state.laeuft ? aufnahmeRot : pauseOrange)
        }
    }
}

/// Roter Kreis mit Wellenform (läuft) bzw. oranger mit Pause-Zeichen.
@available(iOS 16.2, *)
private struct StatusSymbol: View {
    let laeuft: Bool
    let groesse: CGFloat

    var body: some View {
        ZStack {
            Circle().fill((laeuft ? aufnahmeRot : pauseOrange).opacity(0.22))
            Image(systemName: laeuft ? "waveform" : "pause.fill")
                .font(.system(size: groesse * 0.46, weight: .semibold))
                .foregroundStyle(laeuft ? aufnahmeRot : pauseOrange)
        }
        .frame(width: groesse, height: groesse)
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

/// Öffnet die App und beendet dort die Aufnahme (AppDelegate → Web-App).
private struct StoppKnopf: View {
    var body: some View {
        Link(destination: AufnahmeLink.stopp) {
            HStack(spacing: 6) {
                Image(systemName: "stop.fill")
                Text("Aufnahme beenden")
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(aufnahmeRot, in: Capsule())
        }
    }
}

@available(iOS 16.2, *)
private struct SperrbildschirmAnsicht: View {
    let context: ActivityViewContext<AufnahmeAttributes>

    var body: some View {
        HStack(spacing: 14) {
            StatusSymbol(laeuft: context.state.laeuft, groesse: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.titel)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text(context.state.laeuft ? "Aufnahme läuft" : "Pausiert")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.7))
            }
            Spacer(minLength: 8)
            Dauer(state: context.state)
                .font(.system(size: 26, weight: .semibold, design: .rounded))
                .frame(maxWidth: 110, alignment: .trailing)
            Link(destination: AufnahmeLink.stopp) {
                Image(systemName: "stop.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(aufnahmeRot, in: Circle())
            }
            .accessibilityLabel("Aufnahme beenden")
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
    }
}
