declare module 'simple-spellchecker' {
  export interface Dictionary {
    spellCheck(word: string): boolean;
    isMisspelled(word: string): boolean;
    getSuggestions(word: string, limit?: number, maxDistance?: number): string[];
    checkAndSuggest(word: string, limit?: number, maxDistance?: number): {
      misspelled: boolean;
      suggestions: string[];
    };
    getLength(): number;
  }

  export function getDictionary(
    fileName: string,
    callback: (err: Error | null, dictionary: Dictionary | null) => void
  ): void;

  export function getDictionary(
    fileName: string,
    folderPath: string,
    callback: (err: Error | null, dictionary: Dictionary | null) => void
  ): void;

  export function getDictionarySync(fileName: string, folderPath?: string): Dictionary;
}
