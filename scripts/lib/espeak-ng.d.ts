/** Minimal types for @echogarden/espeak-ng-emscripten (GPL-3.0), which ships none. */
declare module "@echogarden/espeak-ng-emscripten" {
  interface ESpeakNGWorker {
    /** voice identifier, e.g. "roa/es"; returns 0 on success */
    set_voice(identifier: string): number;
    synthesize_ipa(text: string): { code: number; ipa: string };
  }
  interface ESpeakModule {
    eSpeakNGWorker: new () => ESpeakNGWorker;
  }
  const createModule: (opts?: { locateFile?: (file: string) => string; getPreloadedPackage?: (name: string, size: number) => ArrayBuffer }) => Promise<ESpeakModule>;
  export default createModule;
}
