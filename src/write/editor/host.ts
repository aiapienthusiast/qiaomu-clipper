import type { Editor } from '@tiptap/core';

// What the editor needs from the page around it (file pickers, the AI helper, storage of pictures).
export type AiAction = 'polish' | 'shorten' | 'expand' | 'toEnglish' | 'toChinese' | 'continue' | 'custom';

export interface EditorHost {
	pickImages(): void;
	insertImageFiles(editor: Editor, files: File[], at?: number): Promise<void>;
	// Pictures that still point at the web are saved into the local store.
	localizeImages(editor: Editor, quiet?: boolean): Promise<void>;
	aiReady(): boolean;
	runAi(editor: Editor, action: AiAction): void;
}
