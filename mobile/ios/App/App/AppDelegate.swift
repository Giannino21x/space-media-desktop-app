import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// Pfad in der Web-App öffnen (NativeChromeViewController lauscht)
    static let oeffnePfad = Notification.Name("ch.spacemedia.oeffne.pfad")
    /// Noch nicht geöffneter Pfad (App per Link gestartet, WebView lädt noch)
    static var wartenderPfad: String?

    /// Nur eigene, relative Pfade mit harmlosen Zeichen — nie eine fremde Adresse
    static func istEigenerPfad(_ pfad: String) -> Bool {
        guard pfad.hasPrefix("/"), !pfad.hasPrefix("//"), pfad.count <= 300 else { return false }
        let erlaubt = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-_.?=&%")
        return pfad.unicodeScalars.allSatisfy { erlaubt.contains($0) }
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Live Activity: «Aufnahme beenden» in der Dynamic Island / auf dem Sperrbildschirm
        if url.scheme == "spacemedia", url.host == "aufnahme" {
            if url.path == "/stopp" {
                NotificationCenter.default.post(name: LiveActivityBridge.stoppNotification, object: nil)
            }
            return true
        }
        // «Protokoll bereit» in der Insel: spacemedia://oeffne?pfad=/sitzungen/<id>
        // Nach der Anmeldung bei Microsoft/Google im Browser: spacemedia://konto/verbindungen
        if url.scheme == "spacemedia", url.host == "oeffne" || url.host == "konto" {
            let pfad: String?
            if url.host == "oeffne" {
                pfad = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?.first(where: { $0.name == "pfad" })?.value
            } else {
                let seite = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                pfad = "/settings" + (seite.isEmpty ? "" : "?tab=\(seite)")
            }
            if let pfad, AppDelegate.istEigenerPfad(pfad) {
                // Kaltstart: der Controller holt ihn nach dem ersten Laden ab
                AppDelegate.wartenderPfad = pfad
                NotificationCenter.default.post(name: AppDelegate.oeffnePfad, object: nil, userInfo: ["pfad": pfad])
            }
            return true
        }
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
