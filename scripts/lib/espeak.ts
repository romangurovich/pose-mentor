/**
 * eSpeak-NG (GPL-3.0) as a phonemizer: text + voice identifier → eSpeak IPA. Loaded on first use (24 MB data).
 *
 * The data file is handed to the module directly via Emscripten's `getPreloadedPackage` hook: the package's own
 * `locateFile` (set in its pre.js, overriding ours) looks next to the module script, which inside a bundled
 * worker is the wrong place.
 */
import createModule from "@echogarden/espeak-ng-emscripten";
import { respell } from "./phonemes.ts";

export type Ipa = (text: string, voice: string) => string;

let instance: Promise<Ipa> | null = null;

/** `loadData` returns the contents of espeak-ng.data (fetched in the browser, read from disk in Node) */
export function loadEspeak(loadData: () => Promise<ArrayBuffer>): Promise<Ipa> {
  instance ??= loadData()
    .then((data) => createModule({ getPreloadedPackage: () => data }))
    .then((m) => {
      const worker = new m.eSpeakNGWorker();
      let current = "";
      return (text: string, voice: string) => {
        if (voice !== current) {
          const rc = worker.set_voice(voice);
          if (rc !== 0) throw new Error(`eSpeak voice "${voice}" not found (code ${rc})`);
          current = voice;
        }
        const r = worker.synthesize_ipa(respell(text, voice));
        if (r.code !== 0) throw new Error(`eSpeak failed (code ${r.code})`);
        return r.ipa;
      };
    });
  instance.catch(() => (instance = null)); // allow a retry after a failed load
  return instance;
}
