// Preload of the island and the dictation pill (insel/ui) — window.spaceInsel. Only these two local windows load it;
// insel.js checks the sender of every call.

const { contextBridge, ipcRenderer } = require('electron');

const abo = (kanal) => (callback) => {
  const listener = (_event, daten) => callback(daten);
  ipcRenderer.on(kanal, listener);
  return () => ipcRenderer.removeListener(kanal, listener);
};

contextBridge.exposeInMainWorld('spaceInsel', {
  version: 1,
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
  pegel: (wert) => ipcRenderer.invoke('pille:pegel', wert),
  taste: (was) => ipcRenderer.invoke('pille:taste', was),
  audio: (id, mime, daten) => ipcRenderer.invoke('pille:audio', { id, mime, daten }),
  leer: (id) => ipcRenderer.invoke('pille:leer', { id }),
  nochmals: () => ipcRenderer.invoke('pille:nochmals'),
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
});
