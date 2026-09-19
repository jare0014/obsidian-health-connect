export {};

declare global {
    interface DomElementInfo {
        /** Inline styles supported by Obsidian's DOM helper at runtime. */
        style?: string;
    }
}
