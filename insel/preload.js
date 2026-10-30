// Preload of the island, the dictation pill, the SPACE Pet and its throw overlay (insel/ui) — window.spaceInsel.
// Only these local windows load it; insel.js / pet.js check the sender of every call.

const { contextBridge, ipcRenderer } = require('electron');

const abo = (kanal) => (callback) => {
  const listener = (_event, daten) => callback(daten);
  ipcRenderer.on(kanal, listener);
  return () => ipcRenderer.removeListener(kanal, listener);
};

contextBridge.exposeInMainWorld('spaceInsel', {
  version: 2,
  // island → main
  flaechen: (rects) => ipcRenderer.invoke('insel:flaechen', rects),
  ansicht: (name) => ipcRenderer.invoke('insel:ansicht', name),
  fokus: (an) => ipcRenderer.invoke('insel:fokus', an),
  neuLaden: () => ipcRenderer.invoke('insel:neu-laden'),
  oeffnen: (pfad) => ipcRenderer.invoke('insel:oeffnen', pfad),
  fragen: (text, botId) => ipcRenderer.invoke('insel:fragen', { text, botId }),
  freigabe: (id, entscheid) => ipcRenderer.invoke('insel:freigabe', { id, entscheid }),
  dateiZumChat: (name, type, daten) => ipcRenderer.invoke('insel:datei-chat', { name, type, daten }),
  mail: (felder) => ipcRenderer.invoke('insel:mail', felder),
  einstellung: (schluessel, wert) => ipcRenderer.invoke('insel:einstellung', { schluessel, wert }),
  // pill → main
  pillenFlaechen: (rects) => ipcRenderer.invoke('pille:flaechen', rects),
  pegel: (wert, baender) => ipcRenderer.invoke('pille:pegel', wert, baender),
  taste: (was) => ipcRenderer.invoke('pille:taste', was),
  audio: (id, mime, daten) => ipcRenderer.invoke('pille:audio', { id, mime, daten }),
  leer: (id) => ipcRenderer.invoke('pille:leer', { id }),
  nochmals: () => ipcRenderer.invoke('pille:nochmals'),
  meldung: (text, art) => ipcRenderer.invoke('pille:meldung', { text, art }),
  // pet → main
  petSprite: () => ipcRenderer.invoke('pet:sprite'),
  petFlaechen: (flaechen, figur) => ipcRenderer.invoke('pet:flaechen', { flaechen, figur }),
  petBereit: () => ipcRenderer.invoke('pet:bereit'),
  petZiehen: () => ipcRenderer.invoke('pet:ziehen'),
  petFokus: (an) => ipcRenderer.invoke('pet:fokus', an),
  petTaste: (was) => ipcRenderer.invoke('pet:taste', was),
  petOeffnen: (pfad) => ipcRenderer.invoke('pet:oeffnen', pfad),
  petVerstecken: (wahl) => ipcRenderer.invoke('pet:verstecken', wahl),
  petName: (name) => ipcRenderer.invoke('pet:name', name),
  // main → windows
  onLage: abo('insel:lage'),
  onEinstellungen: abo('insel:einstellungen'),
  onZeiger: abo('insel:zeiger'),
  onAussenKlick: abo('insel:aussen-klick'),
  onWecken: abo('insel:wecken'),
  onAufklappen: abo('insel:aufklappen'),
  onAnzeige: abo('insel:anzeige'),
  onDiktat: abo('insel:diktat'),
  onPegel: abo('insel:pegel'),
  onPilleZeiger: abo('pille:zeiger'),
  onPilleStart: abo('pille:start'),
  onPilleFreihand: abo('pille:freihand'),
  onPilleStopp: abo('pille:stopp'),
  // main → pet
  onPetZustand: abo('pet:zustand'),
  onPetDiktat: abo('pet:diktat'),
  onPetPegel: abo('pet:pegel'),
  onPetZeiger: abo('pet:zeiger'),
  onPetEcke: abo('pet:ecke'),
  onPetAussenKlick: abo('pet:aussen-klick'),
  onPetReaktion: abo('pet:reaktion'),
  onPetWurf: abo('pet:wurf'),
  onPetFokusWeg: abo('pet:fokus-weg'),
  // main → throw overlay
  onWurfStart: abo('wurf:start'),
});
