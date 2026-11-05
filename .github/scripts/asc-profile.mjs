// Installs the newest active App Store profile of each target and points the
// Xcode project at it. Profiles change names when Apple or Codemagic recreates
// them, so the names in project.pbxproj cannot be relied on.
import { createPrivateKey, createSign } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, PROJEKT, GITHUB_ENV, PROFIL_ORDNER } = process.env

const ZIELE = [
  { bundleId: 'ch.spacemedia.app', imProjekt: 'SPACE Media App Store', envName: 'PROFIL_APP' },
  { bundleId: 'ch.spacemedia.app.LiveActivity', imProjekt: 'SPACE Media Live Activity App Store', envName: 'PROFIL_LIVE' },
]

function token() {
  const b64url = (wert) => Buffer.from(wert).toString('base64url')
  const jetzt = Math.floor(Date.now() / 1000)
  const kopf = b64url(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }))
  const inhalt = b64url(JSON.stringify({ iss: ASC_ISSUER_ID, iat: jetzt, exp: jetzt + 600, aud: 'appstoreconnect-v1' }))
  const signierer = createSign('SHA256')
  signierer.update(`${kopf}.${inhalt}`)
  const signatur = signierer.sign({ key: createPrivateKey(readFileSync(ASC_KEY_PATH, 'utf8')), dsaEncoding: 'ieee-p1363' })
  return `${kopf}.${inhalt}.${b64url(signatur)}`
}

async function profilFuer(bundleId) {
  const felder = 'name,profileState,profileType,profileContent,uuid,createdDate'
  const adresse = `https://api.appstoreconnect.apple.com/v1/bundleIds?filter[identifier]=${bundleId}&include=profiles&fields[profiles]=${felder}&limit[profiles]=50`
  const antwort = await fetch(adresse, { headers: { Authorization: `Bearer ${token()}` } })
  if (!antwort.ok) throw new Error(`App Store Connect antwortet ${antwort.status} für ${bundleId}`)
  const daten = await antwort.json()
  const app = daten.data.find((eintrag) => eintrag.attributes?.identifier === bundleId)
  if (!app) throw new Error(`App-ID ${bundleId} nicht gefunden`)
  const ids = new Set((app.relationships?.profiles?.data ?? []).map((eintrag) => eintrag.id))
  const aktive = (daten.included ?? [])
    .filter((eintrag) => eintrag.type === 'profiles' && ids.has(eintrag.id))
    .filter(({ attributes: a }) => a.profileState === 'ACTIVE' && a.profileType === 'IOS_APP_STORE')
    .sort((x, y) => y.attributes.createdDate.localeCompare(x.attributes.createdDate))
  if (aktive.length === 0) throw new Error(`Kein aktives App-Store-Profil für ${bundleId}`)
  return aktive[0].attributes
}

const ordner = PROFIL_ORDNER || join(homedir(), 'Library/MobileDevice/Provisioning Profiles')
mkdirSync(ordner, { recursive: true })
const projektDatei = join(PROJEKT, 'project.pbxproj')
let projekt = readFileSync(projektDatei, 'utf8')

for (const ziel of ZIELE) {
  const profil = await profilFuer(ziel.bundleId)
  writeFileSync(join(ordner, `${profil.uuid}.mobileprovision`), Buffer.from(profil.profileContent, 'base64'))

  const alt = `PROVISIONING_PROFILE_SPECIFIER = "${ziel.imProjekt}";`
  if (!projekt.includes(alt)) throw new Error(`Eintrag für ${ziel.bundleId} fehlt im Projekt`)
  projekt = projekt.replaceAll(alt, `PROVISIONING_PROFILE_SPECIFIER = "${profil.name}";`)

  if (GITHUB_ENV) appendFileSync(GITHUB_ENV, `${ziel.envName}=${profil.name}\n`)
  console.log(`${ziel.bundleId}: ${profil.name}`)
}

writeFileSync(projektDatei, projekt)
